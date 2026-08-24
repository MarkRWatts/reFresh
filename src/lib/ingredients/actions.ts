"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { IngredientCategory } from "@/generated/prisma/client";
import { canonicalizeIngredientName } from "@/lib/scraper/ingredientNormalize";

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
