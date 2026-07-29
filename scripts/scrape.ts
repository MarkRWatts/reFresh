import "dotenv/config";
import { fetchSitemapEntries, USER_AGENT } from "@/lib/scraper/sitemap";
import {
  isUpToDate,
  readCachedHtml,
  saveManifestEntry,
  writeCachedHtml,
} from "@/lib/scraper/cache";
import { parseRecipePage, RecipeParseError } from "@/lib/scraper/parseRecipe";
import { upsertRecipe } from "@/lib/scraper/upsertRecipe";
import { asyncPool, sleep } from "@/lib/scraper/asyncPool";
import { prisma } from "@/lib/db";

interface CliArgs {
  limit: number | null;
  sample: number | null;
  concurrency: number;
  force: boolean;
  delayMs: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: null,
    sample: null,
    concurrency: 5,
    force: false,
    delayMs: 200,
  };
  for (const arg of argv) {
    const [key, rawValue] = arg.replace(/^--/, "").split("=");
    if (key === "limit") args.limit = Number(rawValue);
    else if (key === "sample") args.sample = Number(rawValue);
    else if (key === "concurrency") args.concurrency = Number(rawValue);
    else if (key === "force") args.force = true;
    else if (key === "delay-ms") args.delayMs = Number(rawValue);
  }
  return args;
}

/** Picks `count` entries evenly spaced across the list (the sitemap is roughly chronological, so this samples old and new recipes alike). */
function stratifiedSample<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  const picked: T[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(items[Math.floor((i * (items.length - 1)) / (count - 1))]);
  }
  return picked;
}

async function fetchRecipeHtml(url: string): Promise<{ finalUrl: string; html: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return { finalUrl: res.url || url, html: await res.text() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("Fetching recipe sitemap...");
  const allEntries = await fetchSitemapEntries();
  console.log(`Sitemap lists ${allEntries.length} recipe URLs.`);

  const candidates = args.sample ? stratifiedSample(allEntries, args.sample) : allEntries;

  const pending: typeof allEntries = [];
  let skippedUpToDate = 0;
  for (const entry of candidates) {
    if (!args.force && (await isUpToDate(entry.url, entry.lastmod))) {
      skippedUpToDate++;
      continue;
    }
    pending.push(entry);
    if (args.limit && pending.length >= args.limit) break;
  }

  console.log(
    `${pending.length} to scrape this run (${skippedUpToDate} already up to date, ` +
      `concurrency=${args.concurrency}${args.force ? ", forced" : ""}).`,
  );

  let okCount = 0;
  let errorCount = 0;
  const errors: { url: string; message: string }[] = [];

  await asyncPool(pending, args.concurrency, async (entry) => {
    try {
      let html = await readCachedHtml(entry.url);
      let finalUrl = entry.url;
      if (!html) {
        const fetched = await fetchRecipeHtml(entry.url);
        html = fetched.html;
        finalUrl = fetched.finalUrl;
        await writeCachedHtml(entry.url, html);
        await sleep(args.delayMs);
      }

      const parsed = parseRecipePage(finalUrl, html);
      await upsertRecipe(parsed);
      await saveManifestEntry(entry.url, {
        lastmod: entry.lastmod,
        scrapedAt: new Date().toISOString(),
        status: "ok",
      });
      okCount++;
      console.log(`OK   ${parsed.name} (${parsed.proteinType}, ${parsed.calories ?? "?"} kcal)`);
    } catch (err) {
      const message = err instanceof RecipeParseError ? err.message : String(err);
      errorCount++;
      errors.push({ url: entry.url, message });
      await saveManifestEntry(entry.url, {
        lastmod: entry.lastmod,
        scrapedAt: new Date().toISOString(),
        status: "error",
        error: message,
      });
      console.error(`FAIL ${entry.url}: ${message}`);
    }
  });

  console.log("\n--- Summary ---");
  console.log(`Sitemap total:     ${allEntries.length}`);
  console.log(`Skipped (cached):  ${skippedUpToDate}`);
  console.log(`Scraped OK:        ${okCount}`);
  console.log(`Errors:            ${errorCount}`);
  if (errors.length > 0) {
    console.log("\nFirst errors:");
    for (const e of errors.slice(0, 10)) console.log(`  ${e.url}\n    ${e.message}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
