import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCardPdf, UnsupportedCardLayoutError } from "@/lib/pdfImport/parseCardPdf";
import { terminateOcr } from "@/lib/pdfImport/ocr";

/**
 * Debug entry point for the PDF-card parser — parses one scanned HelloFresh
 * card and prints what was extracted, without touching the database. Same
 * role as `npm run scrape` plays for the website scraper: a fast way to
 * check parse quality against a real file before wiring up the DB-writing
 * side.
 *
 * Usage: tsx scripts/import-pdf.ts <path-to-pdf> [--dump-crops <dir>]
 */
async function main() {
  const [pdfPath, ...rest] = process.argv.slice(2);
  if (!pdfPath) {
    console.error("Usage: tsx scripts/import-pdf.ts <path-to-pdf> [--dump-crops <dir>]");
    process.exit(1);
  }
  const dumpIndex = rest.indexOf("--dump-crops");
  const dumpDir = dumpIndex >= 0 ? rest[dumpIndex + 1] : null;

  const pdfBytes = new Uint8Array(await readFile(pdfPath));

  console.log(`Parsing ${pdfPath}...`);
  const parsed = await parseCardPdf(pdfBytes);

  console.log(`\n--- ${parsed.name} ---`);
  console.log(`Template:     ${parsed.templateId}`);
  console.log(`Subtitle:     ${parsed.subtitle ?? "(none)"}`);
  console.log(`Cook minutes: ${parsed.cookMinutes ?? "?"}`);
  console.log(`Servings:     ${parsed.servingCounts.join("P / ")}P`);

  console.log(`\nIngredients (${parsed.ingredients.length} rows):`);
  for (const row of parsed.ingredients) {
    const cells = row.byServing
      .map((q, i) => `[${parsed.servingCounts[i]}P] ${q.quantity ?? "?"} ${q.unit ?? ""}`.trim())
      .join("  ");
    console.log(`  ${row.name.padEnd(24)} ${cells}`);
  }

  console.log(`\nNutrition (per serving):`);
  console.log(
    `  ${parsed.calories ?? "?"} kcal, fat ${parsed.fatGrams ?? "?"}g, sat fat ${parsed.saturatedFatGrams ?? "?"}g, ` +
      `carbs ${parsed.carbsGrams ?? "?"}g, sugar ${parsed.sugarGrams ?? "?"}g, protein ${parsed.proteinGrams ?? "?"}g, ` +
      `salt ${parsed.saltGrams ?? "?"}g, fibre ${parsed.fiberGrams ?? "?"}g`,
  );

  console.log(`\nSteps (${parsed.steps.length}):`);
  for (const [i, step] of parsed.steps.entries()) {
    console.log(`  ${i + 1}. ${step.heading ?? "(no heading read)"} ${step.photo ? "[photo]" : "[no photo]"}`);
    console.log(`     ${step.text.slice(0, 100)}${step.text.length > 100 ? "..." : ""}`);
  }

  if (parsed.warnings.length > 0) {
    console.log(`\nWarnings (${parsed.warnings.length}):`);
    for (const w of parsed.warnings) console.log(`  - ${w}`);
  }

  if (dumpDir) {
    await mkdir(dumpDir, { recursive: true });
    await writeFile(path.join(dumpDir, "cover.png"), parsed.coverPhoto);
    for (const [i, step] of parsed.steps.entries()) {
      if (step.photo) await writeFile(path.join(dumpDir, `step-${i + 1}.png`), step.photo);
    }
    console.log(`\nDumped cover + step crops to ${dumpDir}`);
  }

  await terminateOcr();
}

main().catch(async (err) => {
  if (err instanceof UnsupportedCardLayoutError) {
    console.error(`Unsupported card layout: ${err.message}`);
  } else {
    console.error(err);
  }
  await terminateOcr();
  process.exit(1);
});
