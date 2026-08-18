import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { commitVisionImport, type VisionCardData } from "@/lib/pdfImport/commitVisionImport";

/**
 * Commits one vision-transcribed HelloFresh card into the database. Unlike
 * scripts/import-pdf.ts (which only ever prints what Tesseract-OCR read, as
 * a debug aid), this is the real write path for cards transcribed by a
 * vision-capable Claude session reading the rendered page images directly —
 * see scripts/vision-import-prompt.md for the full workflow this is one
 * step of.
 *
 * Usage: tsx scripts/commit-vision-import.ts <staging-dir> [servingIndex]
 *
 * <staging-dir> must contain a data.json (matching VisionCardData) plus
 * whatever image files it references (coverPhotoFile, each step's
 * photoFile), all as plain relative filenames within that same directory.
 */
async function main() {
  const [stagingDir, servingIndexRaw] = process.argv.slice(2);
  if (!stagingDir) {
    console.error("Usage: tsx scripts/commit-vision-import.ts <staging-dir> [servingIndex]");
    process.exit(1);
  }
  const servingIndex = servingIndexRaw ? Number(servingIndexRaw) : 0;

  const dataPath = path.join(stagingDir, "data.json");
  const data = JSON.parse(await readFile(dataPath, "utf8")) as VisionCardData;

  const missingName = !data.name?.trim();
  const missingIngredients = !data.ingredients || data.ingredients.length === 0;
  const missingSteps = !data.steps || data.steps.length === 0;
  if (missingName || missingIngredients || missingSteps) {
    console.error(
      `data.json at ${dataPath} looks incomplete (name=${!missingName}, ingredients=${!missingIngredients}, steps=${!missingSteps}) — not committing.`,
    );
    process.exit(1);
  }

  const recipe = await commitVisionImport(stagingDir, data, servingIndex);
  console.log(`Committed "${data.name}" -> /recipes/${recipe.slug} (id ${recipe.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
