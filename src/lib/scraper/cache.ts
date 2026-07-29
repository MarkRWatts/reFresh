import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "hellofresh");
const HTML_DIR = path.join(CACHE_DIR, "html");
const MANIFEST_PATH = path.join(CACHE_DIR, "manifest.json");

export interface ManifestEntry {
  lastmod: string | null;
  scrapedAt: string;
  status: "ok" | "error";
  error?: string;
}

type Manifest = Record<string, ManifestEntry>;

let manifestCache: Manifest | null = null;
// Recipes are scraped with several concurrent workers, and every worker
// calls loadManifest()/saveManifestEntry(). Without serializing disk access,
// concurrent first-time loads can race, and a concurrent write can truncate
// manifest.json while another read is mid-flight — producing a corrupt
// partial read ("Unexpected end of JSON input"). All disk access to the
// manifest is chained through this single promise so it's never touched
// concurrently.
let manifestQueue: Promise<Manifest> = (async () => {
  await mkdir(HTML_DIR, { recursive: true });
  if (!existsSync(MANIFEST_PATH)) return {};
  const raw = await readFile(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Manifest;
})().then((manifest) => {
  manifestCache = manifest;
  return manifest;
});

async function ensureDirs() {
  await mkdir(HTML_DIR, { recursive: true });
}

export function loadManifest(): Promise<Manifest> {
  return manifestQueue;
}

export function saveManifestEntry(url: string, entry: ManifestEntry): Promise<void> {
  manifestQueue = manifestQueue.then(async (manifest) => {
    manifest[url] = entry;
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
    return manifest;
  });
  return manifestQueue.then(() => undefined);
}

/** Slugify a sitemap URL into a filesystem-safe cache key. */
function cacheKeyForUrl(url: string): string {
  const { pathname } = new URL(url);
  return pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function htmlCachePath(url: string): string {
  return path.join(HTML_DIR, `${cacheKeyForUrl(url)}.html`);
}

export async function readCachedHtml(url: string): Promise<string | null> {
  const filePath = htmlCachePath(url);
  if (!existsSync(filePath)) return null;
  return readFile(filePath, "utf-8");
}

export async function writeCachedHtml(url: string, html: string): Promise<void> {
  await ensureDirs();
  await writeFile(htmlCachePath(url), html, "utf-8");
}

/**
 * Whether a sitemap URL can be skipped this run: we've already scraped it
 * successfully before and its lastmod hasn't changed since.
 */
export async function isUpToDate(url: string, lastmod: string | null): Promise<boolean> {
  const manifest = await loadManifest();
  const entry = manifest[url];
  if (!entry || entry.status !== "ok") return false;
  if (entry.lastmod === null || lastmod === null) return false;
  return entry.lastmod === lastmod && existsSync(htmlCachePath(url));
}
