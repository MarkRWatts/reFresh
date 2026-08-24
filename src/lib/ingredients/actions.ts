"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { IngredientCategory } from "@/generated/prisma/client";
import { canonicalizeIngredientName } from "@/lib/scraper/ingredientNormalize";
import { normalizeUnitLabel } from "./unitSynonyms";

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
 * Rewrites ONE recipe's ingredient line to use a packaged-unit quantity
 * instead of a raw weight/volume — e.g. "10g" of beef stock paste becomes
 * "1x" beef stock pot, because that particular recipe's amount turned out
 * to be (close to) a whole pot. Deliberately per-row, not per-ingredient:
 * see getIngredientConversionReview's doc comment for why this can't be a
 * blanket rule (a different recipe using the same ingredient might
 * legitimately want a different, non-whole-pot amount). Only `quantity`
 * and `unit` change — `rawText` (what HelloFresh's page actually said) is
 * left alone as a provenance record, and isn't shown anywhere in the app
 * itself, so there's nothing user-visible left inconsistent.
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
 * Bulk-relabels every recipe currently recording this ingredient in the
 * "other" of grams/millilitres (whichever one isn't packagedUnitBase) to
 * packagedUnitBase instead — e.g. every "150g creme fraiche" becomes
 * "150ml creme fraiche". The number itself never changes, only the unit
 * label, so unlike applyPackagedUnitConversion this doesn't need a
 * per-row "is this a clean fraction of a pack" check — it's the same
 * density assumption (~1g ≈ 1ml) already flagged on every "assumes
 * 1g≈1ml" suggestion, just without additionally rounding to a pack
 * count. Safe to run before doing any pack-count conversions: once a row
 * reads "ml" for real, matching it against the pack size stops requiring
 * that assumption at all. Still a bulk write, so callers should confirm
 * with the user first (see RebaseToMlButton).
 */
export async function rebaseIngredientToPackagedBase(ingredientId: string): Promise<number> {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient?.packagedUnitBase) return 0;
  const base = ingredient.packagedUnitBase;
  const otherBase = base === "g" ? "ml" : base === "ml" ? "g" : null;
  if (!otherBase) return 0;

  const usages = await prisma.recipeIngredient.findMany({
    where: { ingredientId, unit: { not: null } },
    select: { id: true, unit: true },
  });
  const idsToRebase = usages.filter((u) => normalizeUnitLabel(u.unit) === otherBase).map((u) => u.id);
  if (idsToRebase.length === 0) return 0;

  await prisma.recipeIngredient.updateMany({
    where: { id: { in: idsToRebase } },
    data: { unit: base },
  });
  revalidatePath(`/ingredients/review/${ingredientId}/convert`);
  return idsToRebase.length;
}
