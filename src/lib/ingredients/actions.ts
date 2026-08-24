"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { IngredientCategory } from "@/generated/prisma/client";
import { canonicalizeIngredientName } from "@/lib/scraper/ingredientNormalize";
import { isPackagedUnitMention, normalizeUnitLabel } from "./unitSynonyms";

const REVIEW_PATH = "/ingredients/review";

export interface RenameResult {
  /** The canonical name of the ingredient `id` got merged into, or null if this was a plain rename (no collision). */
  mergedInto: string | null;
}

/**
 * Renames an ingredient's canonical name — or, if the new name (after the
 * same canonicalization every scraped/typed ingredient goes through)
 * collides with a different existing ingredient, merges `id` into that
 * ingredient instead: every RecipeIngredient and IngredientAlias row moves
 * over, and `id`'s row is deleted. Same reassignment scripts/merge-
 * ingredients.ts does in bulk, just for one manual edit at a time.
 *
 * Preserving the alias rows on merge (rather than dropping them) matters
 * for the future, not just the past: resolveIngredientId looks up by exact
 * raw text before ever touching canonicalName, so a future re-scrape that
 * reuses a raw ingredient string seen before keeps resolving straight to
 * the merged-into ingredient instead of splitting again.
 */
export async function renameOrMergeIngredient(id: string, rawName: string): Promise<RenameResult> {
  const canonicalName = canonicalizeIngredientName(rawName);
  if (!canonicalName) return { mergedInto: null };

  const existing = await prisma.ingredient.findUnique({ where: { canonicalName } });

  if (existing && existing.id !== id) {
    await prisma.recipeIngredient.updateMany({
      where: { ingredientId: id },
      data: { ingredientId: existing.id },
    });
    await prisma.ingredientAlias.updateMany({
      where: { ingredientId: id },
      data: { ingredientId: existing.id },
    });
    await prisma.ingredient.delete({ where: { id } });
    revalidatePath(REVIEW_PATH);
    return { mergedInto: existing.canonicalName };
  }

  await prisma.ingredient.update({ where: { id }, data: { canonicalName } });
  revalidatePath(REVIEW_PATH);
  return { mergedInto: null };
}

export async function updateIngredientCategory(id: string, category: IngredientCategory): Promise<void> {
  await prisma.ingredient.update({ where: { id }, data: { category } });
  revalidatePath(REVIEW_PATH);
}

export interface PackagingUpdate {
  packagedUnit: string | null;
  packagedUnitQuantity: number | null;
  packagedUnitBase: string | null;
  packagedUnitBaseGrams: number | null;
}

export async function updateIngredientPackaging(id: string, data: PackagingUpdate): Promise<void> {
  await prisma.ingredient.update({ where: { id }, data });
  revalidatePath(REVIEW_PATH);
}

export async function updateIngredientNote(id: string, shoppingListNote: string | null): Promise<void> {
  await prisma.ingredient.update({
    where: { id },
    data: { shoppingListNote: shoppingListNote?.trim() || null },
  });
  revalidatePath(REVIEW_PATH);
}

/**
 * Rewrites ONE recipe's ingredient line to a specific quantity/unit —
 * used for every per-row apply on the conversion review page (filling in
 * a missing unit, relabeling grams as ml, or multiplying out an explicit
 * packaged-unit mention into the base measure). Deliberately per-row, not
 * per-ingredient: see getIngredientConversionReview's doc comment for why
 * this can't be a blanket rule applied identically to every recipe. Only
 * `quantity` and `unit` change — `rawText` (what HelloFresh's page
 * actually said) is left alone as a provenance record, and isn't shown
 * anywhere in the app itself, so there's nothing user-visible left
 * inconsistent.
 */
export async function applyPackagedUnitConversion(
  recipeIngredientId: string,
  ingredientId: string,
  quantity: number,
  unit: string,
): Promise<void> {
  await prisma.recipeIngredient.update({
    where: { id: recipeIngredientId },
    data: { quantity, unit },
  });
  revalidatePath(`/ingredients/review/${ingredientId}/convert`);
}

/**
 * Bulk-fixes every recipe currently recording this ingredient as either
 * (a) a bare number with no unit at all, or (b) the "other" of grams/
 * millilitres (whichever one isn't packagedUnitBase) — both become
 * packagedUnitBase, e.g. "150 Creme Fraiche" and "150g Creme Fraiche"
 * both become "150ml Creme Fraiche". The number itself never changes,
 * only the unit label: a missing unit is simply filled in, and the
 * grams/ml case relies on the same density assumption (~1g ≈ 1ml)
 * already flagged wherever "assumes 1g≈1ml" appears, applied uniformly
 * rather than needing a per-row judgment call — a straight relabel loses
 * no precision, unlike snapping to a pack count would.
 *
 * Deliberately skips small bare numbers (< 10% of one packaged unit) —
 * see getIngredientConversionReview's "missing-unit-ambiguous" — those
 * are more likely a packaged-unit count written without its label (e.g.
 * "0.75" meaning "¾ pot") than an implausibly tiny base-unit amount, so
 * this bulk action would silently get them wrong. Left for individual
 * review instead.
 *
 * Still a bulk write for everything it does touch, so callers should
 * confirm with the user first (see BulkConversionButton).
 */
export async function rebaseIngredientToPackagedBase(ingredientId: string): Promise<number> {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient?.packagedUnitBase || ingredient.packagedUnitQuantity == null) return 0;
  const base = ingredient.packagedUnitBase;
  const normalizedBase = normalizeUnitLabel(base);
  const otherBase = normalizedBase === "g" ? "ml" : normalizedBase === "ml" ? "g" : null;
  const ambiguityThreshold = ingredient.packagedUnitQuantity * 0.1;

  const usages = await prisma.recipeIngredient.findMany({
    where: { ingredientId, quantity: { not: null } },
    select: { id: true, unit: true, quantity: true },
  });
  const idsToRebase = usages
    .filter((u) => {
      if (u.unit == null) return u.quantity! >= ambiguityThreshold;
      return otherBase != null && normalizeUnitLabel(u.unit) === otherBase;
    })
    .map((u) => u.id);
  if (idsToRebase.length === 0) return 0;

  await prisma.recipeIngredient.updateMany({
    where: { id: { in: idsToRebase } },
    data: { unit: base },
  });
  revalidatePath(`/ingredients/review/${ingredientId}/convert`);
  return idsToRebase.length;
}

/**
 * Bulk-converts every recipe that records this ingredient directly in
 * its packaged unit, or HelloFresh's generic "sachet(s)" label for one
 * (e.g. "1 pot"), into the base measure by multiplying
 * out — "1 pot" of a 150ml pack becomes "150ml". Unlike
 * rebaseIngredientToPackagedBase this changes the number, not just the
 * label, but it's still fully deterministic (no rounding/judgment
 * involved) — a recipe should store a precise, scalable amount rather
 * than a purchase-size count, which is also the direction
 * computeSharedIngredients (sharedIngredients.ts) already treats as
 * canonical for shopping-list summing. Runs as individual updates rather
 * than one updateMany since each row's new quantity depends on its own
 * old quantity — fine at the scale this runs at (how many recipes
 * literally spell out "1 pot" is small by construction).
 */
export async function convertPackagedUnitMentionsToBase(ingredientId: string): Promise<number> {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient?.packagedUnit || ingredient.packagedUnitQuantity == null || !ingredient.packagedUnitBase) {
    return 0;
  }

  const candidates = await prisma.recipeIngredient.findMany({
    where: { ingredientId, quantity: { not: null } },
    select: { id: true, quantity: true, unit: true },
  });
  const usages = candidates.filter((u) => isPackagedUnitMention(u.unit, ingredient.packagedUnit!));
  if (usages.length === 0) return 0;

  await Promise.all(
    usages.map((u) =>
      prisma.recipeIngredient.update({
        where: { id: u.id },
        data: { quantity: u.quantity! * ingredient.packagedUnitQuantity!, unit: ingredient.packagedUnitBase },
      }),
    ),
  );
  revalidatePath(`/ingredients/review/${ingredientId}/convert`);
  return usages.length;
}

/**
 * Bulk-converts every recipe currently recording this ingredient in grams
 * into packagedUnitBase, using packagedUnitBaseGrams — a per-ingredient
 * fact ("15g = 1 tbsp of honey", derived by a human cross-referencing
 * overlapping gram/base-unit data for this exact ingredient, see
 * getIngredientConversionReview's "gram-ratio-known" bucket) rather than
 * the generic ~1g≈1ml density guess rebaseIngredientToPackagedBase uses.
 *
 * Deliberately no magnitude threshold here: a ratio derived from small
 * (e.g. tablespoon-scale) amounts isn't guaranteed to hold at a very
 * different scale (plain flour's 8g≈1tbsp held for dredging amounts but
 * not for 75g+ baking amounts, which turned out to be weighed on a scale
 * instead) — that judgment call is left to whoever reviews the table
 * before clicking this, not encoded as a rule. Skip individually-odd rows
 * via the per-row Apply button instead.
 */
export async function applyGramRatioConversion(ingredientId: string): Promise<number> {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient?.packagedUnitBase || ingredient.packagedUnitBaseGrams == null) return 0;
  const normalizedBase = normalizeUnitLabel(ingredient.packagedUnitBase);
  if (normalizedBase === "g" || normalizedBase === "ml") return 0;

  const usages = await prisma.recipeIngredient.findMany({
    where: { ingredientId, quantity: { not: null } },
    select: { id: true, quantity: true, unit: true },
  });
  const toConvert = usages.filter((u) => normalizeUnitLabel(u.unit) === "g");
  if (toConvert.length === 0) return 0;

  await Promise.all(
    toConvert.map((u) =>
      prisma.recipeIngredient.update({
        where: { id: u.id },
        data: { quantity: u.quantity! / ingredient.packagedUnitBaseGrams!, unit: ingredient.packagedUnitBase! },
      }),
    ),
  );
  revalidatePath(`/ingredients/review/${ingredientId}/convert`);
  return toConvert.length;
}
