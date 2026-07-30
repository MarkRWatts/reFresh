import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { hasUsableImage } from "@/lib/recipes/imageUrl";
import { resolveIngredientId } from "@/lib/recipes/ingredientResolution";
import type { ParsedRecipe } from "./parseRecipe";

/**
 * Some scraped pages aren't a real cookable recipe: legacy/empty stub
 * entries with no ingredients, GAP-filler placeholders, internal test
 * recipes, box-bundle components, and serving-suggestion platters (e.g. a
 * cheese board) all share the same tell — no real multi-step method.
 *
 * HelloFresh's own isPublished/active flags (see appData.ts) were tried
 * as a filter too, but rejected after checking a content sample: they
 * mark a recipe unpublished once it rotates out of the current menu, not
 * just for drafts/junk. Plenty of unpublished recipes are completely
 * legitimate — full 6-step methods, real photos, real nutrition (e.g.
 * "Thai Green Style Chicken Curry") — and would have been wrongly hidden.
 * Still stored on the Recipe model as informational metadata, just not
 * used here.
 *
 * A missing/unusable image is also treated as a visibility signal, not
 * just a display fallback: browsing hellofresh.co.uk directly, you never
 * see a recipe tile without a photo, so a recipe lacking one is exactly
 * the same kind of incomplete/non-real entry as one with no ingredients.
 */
function computeIsBrowsable(parsed: ParsedRecipe): boolean {
  if (parsed.ingredients.length === 0) return false;
  if (parsed.steps.length <= 1) return false;
  if (!hasUsableImage(parsed.imageUrl)) return false;
  return true;
}

/**
 * Upserts a parsed recipe and fully replaces its ingredient rows. Recipes
 * are keyed on `hfId`, which is derived from the final (post-redirect) URL,
 * so multiple sitemap URLs that resolve to the same recipe variant collapse
 * into a single row automatically.
 */
export async function upsertRecipe(parsed: ParsedRecipe): Promise<void> {
  const existing = await prisma.recipe.findUnique({ where: { hfId: parsed.hfId } });

  const proteinType =
    existing?.proteinTypeManualOverride ? existing.proteinType : parsed.proteinType;
  const isBrowsable = computeIsBrowsable(parsed);

  const recipe = await prisma.recipe.upsert({
    where: { hfId: parsed.hfId },
    create: {
      hfId: parsed.hfId,
      slug: parsed.slug,
      name: parsed.name,
      subtitle: parsed.subtitle,
      description: parsed.description,
      imageUrl: parsed.imageUrl,
      sourceUrl: parsed.sourceUrl,
      cookMinutes: parsed.cookMinutes,
      servings: parsed.servings,
      calories: parsed.calories,
      fatGrams: parsed.fatGrams,
      saturatedFatGrams: parsed.saturatedFatGrams,
      carbsGrams: parsed.carbsGrams,
      sugarGrams: parsed.sugarGrams,
      proteinGrams: parsed.proteinGrams,
      fiberGrams: parsed.fiberGrams,
      saltGrams: parsed.saltGrams,
      proteinType,
      cuisine: parsed.cuisine,
      category: parsed.category,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
      ratingValue: parsed.ratingValue,
      ratingCount: parsed.ratingCount,
      isPublished: parsed.isPublished,
      isActive: parsed.isActive,
      isBrowsable,
    },
    update: {
      slug: parsed.slug,
      name: parsed.name,
      subtitle: parsed.subtitle,
      description: parsed.description,
      imageUrl: parsed.imageUrl,
      sourceUrl: parsed.sourceUrl,
      cookMinutes: parsed.cookMinutes,
      servings: parsed.servings,
      calories: parsed.calories,
      fatGrams: parsed.fatGrams,
      saturatedFatGrams: parsed.saturatedFatGrams,
      carbsGrams: parsed.carbsGrams,
      sugarGrams: parsed.sugarGrams,
      proteinGrams: parsed.proteinGrams,
      fiberGrams: parsed.fiberGrams,
      saltGrams: parsed.saltGrams,
      proteinType,
      cuisine: parsed.cuisine,
      category: parsed.category,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
      ratingValue: parsed.ratingValue,
      ratingCount: parsed.ratingCount,
      isPublished: parsed.isPublished,
      isActive: parsed.isActive,
      isBrowsable,
      lastScrapedAt: new Date(),
    },
  });

  await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });

  for (const ingredient of parsed.ingredients) {
    const ingredientId = await resolveIngredientId(ingredient.name);
    await prisma.recipeIngredient.create({
      data: {
        recipeId: recipe.id,
        ingredientId,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        rawText: ingredient.rawText,
      },
    });
  }
}
