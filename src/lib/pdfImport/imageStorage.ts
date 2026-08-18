import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedCardRecipe } from "./parseCardPdf";

// Not under public/ — that directory is baked into the Docker image at
// build time (see Dockerfile), not a volume, so anything written there at
// runtime would vanish on the next deploy. This directory is its own named
// volume instead (see docker-compose.yml) and served via the route handler
// at src/app/api/recipe-images/[...path]/route.ts.
const RECIPE_IMAGES_DIR = process.env.RECIPE_IMAGES_DIR ?? "./storage/recipe-images";

function draftDir(draftId: string): string {
  return path.join(RECIPE_IMAGES_DIR, "_drafts", draftId);
}

function recipeDir(recipeId: string): string {
  return path.join(RECIPE_IMAGES_DIR, recipeId);
}

function stepFilename(index: number): string {
  return `step-${index + 1}.png`;
}

function stepTextFilename(index: number): string {
  return `step-${index + 1}-text.png`;
}

const STEP_FILENAME_PATTERN = /^step-(\d+)\.png$/;

/** The same-origin URL the recipe-images route handler serves this file at, suitable for storing directly in Recipe.imageUrl / a step's imageUrl. */
export function recipeImageUrl(recipeId: string, filename: string): string {
  return `/api/recipe-images/${recipeId}/${filename}`;
}

function draftImageUrl(draftId: string, filename: string): string {
  return `/api/recipe-images/_drafts/${draftId}/${filename}`;
}

/**
 * Reconstructs a draft's image URLs from its id + step count — the review
 * page's route param is all it's given, and the draft's stored JSON has no
 * photo data (see toDraftRecipeData), so this checks disk directly for
 * which steps actually got a photo file. Not every step has one — some
 * legacy card layouts only photograph a handful of steps, or (for a
 * "flowing" step layout) don't get photo-matched at all — so this returns
 * null for whichever indices are missing rather than assuming a contiguous
 * step-1..N run.
 */
async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false,
  );
}

export interface DraftImageUrls {
  coverImageUrl: string;
  stepImageUrls: (string | null)[];
  /** OCR source-crop previews, shown next to the field(s) they produced on the review screen — see saveDraftImages. Null wherever that section had no matching region to crop (see ParsedCardRecipe.ingredientsCrop/nutritionCrop/ParsedCardStep.textCrop). */
  ingredientsImageUrl: string | null;
  nutritionImageUrl: string | null;
  stepTextImageUrls: (string | null)[];
}

/**
 * Reconstructs a draft's image URLs from its id + step count — the review
 * page's route param is all it's given, and the draft's stored JSON has no
 * photo data (see toDraftRecipeData), so this checks disk directly for
 * which steps actually got a photo file. Not every step has one — some
 * legacy card layouts only photograph a handful of steps, or (for a
 * "flowing" step layout) don't get photo-matched at all — so this returns
 * null for whichever indices are missing rather than assuming a contiguous
 * step-1..N run.
 */
export async function draftImageUrls(draftId: string, stepCount: number): Promise<DraftImageUrls> {
  const dir = draftDir(draftId);
  const stepImageUrls: (string | null)[] = [];
  const stepTextImageUrls: (string | null)[] = [];
  for (let i = 0; i < stepCount; i++) {
    stepImageUrls.push((await fileExists(path.join(dir, stepFilename(i)))) ? draftImageUrl(draftId, stepFilename(i)) : null);
    stepTextImageUrls.push(
      (await fileExists(path.join(dir, stepTextFilename(i)))) ? draftImageUrl(draftId, stepTextFilename(i)) : null,
    );
  }
  const ingredientsImageUrl = (await fileExists(path.join(dir, "ingredients.png")))
    ? draftImageUrl(draftId, "ingredients.png")
    : null;
  const nutritionImageUrl = (await fileExists(path.join(dir, "nutrition.png")))
    ? draftImageUrl(draftId, "nutrition.png")
    : null;
  return {
    coverImageUrl: draftImageUrl(draftId, "cover.png"),
    stepImageUrls,
    ingredientsImageUrl,
    nutritionImageUrl,
    stepTextImageUrls,
  };
}

/**
 * Writes a freshly-parsed card's cover + step photos, plus its OCR
 * source-crop previews (ingredients/nutrition/per-step text — see
 * ParsedCardRecipe), to a per-draft staging folder. Steps with no photo
 * (see ParsedCardStep.photo) simply get no file written for them, same for
 * any crop that came back null. The preview crops are validation aids
 * only — see promoteDraftImages for why they don't survive past the draft.
 */
export async function saveDraftImages(
  draftId: string,
  parsed: Pick<ParsedCardRecipe, "coverPhoto" | "steps" | "ingredientsCrop" | "nutritionCrop">,
): Promise<void> {
  const dir = draftDir(draftId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "cover.png"), parsed.coverPhoto);
  if (parsed.ingredientsCrop) await writeFile(path.join(dir, "ingredients.png"), parsed.ingredientsCrop);
  if (parsed.nutritionCrop) await writeFile(path.join(dir, "nutrition.png"), parsed.nutritionCrop);
  await Promise.all(
    parsed.steps.flatMap((step, i) => [
      step.photo ? writeFile(path.join(dir, stepFilename(i)), step.photo) : Promise.resolve(),
      step.textCrop ? writeFile(path.join(dir, stepTextFilename(i)), step.textCrop) : Promise.resolve(),
    ]),
  );
}

/**
 * Moves a draft's cover + step photos to their permanent per-recipe
 * location once the draft is committed, returning URLs indexed by step
 * position (null wherever that step never had a photo file). Deliberately
 * moves those files individually rather than renaming the whole draft
 * folder — the folder also holds OCR source-crop previews
 * (ingredients.png/nutrition.png/step-N-text.png, see saveDraftImages),
 * which are validation aids only and don't belong in the committed
 * recipe's permanent image folder, so they're discarded here along with
 * whatever's left of the draft folder rather than promoted.
 */
export async function promoteDraftImages(
  draftId: string,
  recipeId: string,
): Promise<{ coverImageUrl: string; stepImageUrls: (string | null)[] }> {
  const from = draftDir(draftId);
  const to = recipeDir(recipeId);
  await mkdir(to, { recursive: true });

  const files = await readdir(from);
  const stepIndices = files
    .map((f) => STEP_FILENAME_PATTERN.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]) - 1);
  const maxIndex = stepIndices.length > 0 ? Math.max(...stepIndices) : -1;
  const present = new Set(stepIndices);

  await rename(path.join(from, "cover.png"), path.join(to, "cover.png"));
  const stepImageUrls: (string | null)[] = [];
  for (let i = 0; i <= maxIndex; i++) {
    if (present.has(i)) {
      await rename(path.join(from, stepFilename(i)), path.join(to, stepFilename(i)));
      stepImageUrls.push(recipeImageUrl(recipeId, stepFilename(i)));
    } else {
      stepImageUrls.push(null);
    }
  }

  await rm(from, { recursive: true, force: true });

  return { coverImageUrl: recipeImageUrl(recipeId, "cover.png"), stepImageUrls };
}

/** Deletes a draft's staged images — called when a draft is discarded rather than committed. */
export async function deleteDraftImages(draftId: string): Promise<void> {
  await rm(draftDir(draftId), { recursive: true, force: true });
}

/** Deletes a recipe's own image folder — called when a custom/PDF-imported recipe is deleted (see recipeEditActions.ts's deleteRecipe). A no-op (force: true swallows the missing-directory error) for a recipe that never had one of its own, e.g. a clone of a scraped recipe, whose imageUrl just points at the source's own image/CDN URL by reference rather than a copy under this recipe's id. */
export async function deleteRecipeImages(recipeId: string): Promise<void> {
  await rm(recipeDir(recipeId), { recursive: true, force: true });
}

/** Resolves a URL path (as served by the route handler, e.g. "_drafts/<id>/cover.png") to its file on disk, rejecting anything that would escape RECIPE_IMAGES_DIR. */
export function resolveRecipeImagePath(segments: string[]): string | null {
  if (segments.some((s) => s.includes("..") || s.includes("/") || s.includes("\\"))) return null;
  const resolved = path.join(RECIPE_IMAGES_DIR, ...segments);
  const root = path.resolve(RECIPE_IMAGES_DIR);
  if (!path.resolve(resolved).startsWith(root + path.sep)) return null;
  return resolved;
}
