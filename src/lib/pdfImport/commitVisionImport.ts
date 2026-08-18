import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { resolveIngredientId } from "@/lib/recipes/ingredientResolution";
import { classifyProteinType } from "@/lib/scraper/proteinType";
import { slugify, uniqueSlug } from "@/lib/recipes/slug";
import { promoteDraftImages, saveDraftImages } from "./imageStorage";

/**
 * The shape a card's data must be transcribed into for commitVisionImport —
 * deliberately close to ParsedCardRecipe/DraftRecipeData (see
 * parseCardPdf.ts) so this stays a drop-in alternative source for the same
 * downstream persistence, just produced by a human/vision read of the page
 * images instead of Tesseract OCR. File paths are relative to the staging
 * directory passed to commitVisionImport.
 */
export interface VisionCardIngredient {
  name: string;
  /** One entry per servingCounts index, e.g. index 0 is the 2-person quantity. */
  byServing: Array<{ quantity: number | null; unit: string | null; rawText: string }>;
}

export interface VisionCardStep {
  heading: string | null;
  text: string;
  /** Filename within the staging dir, e.g. "step-1.png" — null if this step has no photo on the card. */
  photoFile: string | null;
}

export interface VisionCardData {
  name: string;
  subtitle: string | null;
  cookMinutes: number | null;
  /** e.g. [2, 3, 4] for a 2P/3P/4P card. */
  servingCounts: number[];
  /** Filename within the staging dir, e.g. "cover.png". */
  coverPhotoFile: string;
  ingredients: VisionCardIngredient[];
  steps: VisionCardStep[];
  calories: number | null;
  fatGrams: number | null;
  saturatedFatGrams: number | null;
  carbsGrams: number | null;
  sugarGrams: number | null;
  proteinGrams: number | null;
  saltGrams: number | null;
  fiberGrams: number | null;
}

/**
 * Writes a vision-transcribed card straight into the database as a real,
 * browsable Recipe — the automated-import counterpart to commitImport.ts's
 * commitPdfImportDraft, which instead takes a human-reviewed FormData
 * submission from the /recipes/import/[draftId] screen. Deliberately doesn't
 * touch that server action or go through a PdfImportDraft row: there's no
 * FormData here, and no Next.js request context to run redirect()/
 * revalidatePath() in when called from a script (see scripts/
 * commit-vision-import.ts). The two share every downstream persistence
 * concern (image storage, ingredient resolution, protein classification,
 * slugging) by calling the same lib functions, not by sharing code with
 * each other.
 */
export async function commitVisionImport(
  stagingDir: string,
  data: VisionCardData,
  servingIndex = 0,
): Promise<{ id: string; slug: string }> {
  // saveDraftImages/promoteDraftImages address images by a draft id under
  // RECIPE_IMAGES_DIR/_drafts/<id>/ — reused here purely as a mechanism to
  // get files onto disk at their final per-recipe location; there's no real
  // PdfImportDraft row behind this id.
  const draftId = `vision-${crypto.randomUUID()}`;

  const coverPhoto = await readFile(path.join(stagingDir, data.coverPhotoFile));
  const steps = await Promise.all(
    data.steps.map(async (step) => ({
      heading: step.heading,
      text: step.text,
      photo: step.photoFile ? await readFile(path.join(stagingDir, step.photoFile)) : null,
      textCrop: null,
    })),
  );
  await saveDraftImages(draftId, { coverPhoto, steps, ingredientsCrop: null, nutritionCrop: null });

  const servings = data.servingCounts[servingIndex] ?? data.servingCounts[0] ?? null;
  const ingredients = data.ingredients.map((row) => {
    const cell = row.byServing[servingIndex] ?? row.byServing[0] ?? null;
    return { name: row.name, quantity: cell?.quantity ?? null, unit: cell?.unit ?? null };
  });
  const proteinType = classifyProteinType({ ingredientNames: ingredients.map((i) => i.name), name: data.name });

  const slug = await uniqueSlug(slugify(data.name));
  const hfId = `pdf-${crypto.randomUUID()}`;

  const recipe = await prisma.recipe.create({
    data: {
      hfId,
      slug,
      name: data.name,
      subtitle: data.subtitle,
      sourceUrl: null,
      cookMinutes: data.cookMinutes,
      servings,
      calories: data.calories,
      fatGrams: data.fatGrams,
      saturatedFatGrams: data.saturatedFatGrams,
      carbsGrams: data.carbsGrams,
      sugarGrams: data.sugarGrams,
      proteinGrams: data.proteinGrams,
      saltGrams: data.saltGrams,
      fiberGrams: data.fiberGrams,
      proteinType,
      steps: [],
      isBrowsable: true,
      isUserCreated: true,
      isPdfImport: true,
    },
  });

  const { coverImageUrl, stepImageUrls } = await promoteDraftImages(draftId, recipe.id);
  const finalSteps = data.steps.map((step, i) => ({
    heading: step.heading,
    text: step.text,
    imageUrl: stepImageUrls[i] ?? null,
    caption: null,
  }));

  await prisma.recipe.update({
    where: { id: recipe.id },
    data: { imageUrl: coverImageUrl, steps: finalSteps },
  });

  for (const ingredient of ingredients) {
    const ingredientId = await resolveIngredientId(ingredient.name);
    const rawText = [ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
    await prisma.recipeIngredient.create({
      data: { recipeId: recipe.id, ingredientId, quantity: ingredient.quantity, unit: ingredient.unit, rawText },
    });
  }

  return { id: recipe.id, slug: recipe.slug };
}
