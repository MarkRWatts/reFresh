import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { IngredientReviewRow } from "./types";

export type { IngredientReviewRow } from "./types";

export interface IngredientReviewParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;

export interface IngredientReviewResult {
  rows: IngredientReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated, searchable ingredient list for the one-time manual review
 * page (name/merge cleanup, category, packaged-unit sizing, shopping-list
 * substitution notes) — sorted by usage count descending by default so the
 * highest-impact ingredients (the ones appearing in the most recipes) get
 * reviewed first.
 */
export async function listIngredientsForReview(
  params: IngredientReviewParams = {},
): Promise<IngredientReviewResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const where: Prisma.IngredientWhereInput = params.search
    ? { canonicalName: { contains: params.search, mode: "insensitive" } }
    : {};

  const [ingredients, total] = await Promise.all([
    prisma.ingredient.findMany({
      where,
      select: {
        id: true,
        canonicalName: true,
        category: true,
        packagedUnit: true,
        packagedUnitQuantity: true,
        packagedUnitBase: true,
        shoppingListNote: true,
        _count: { select: { recipeIngredients: true } },
      },
      orderBy: [{ recipeIngredients: { _count: "desc" } }, { canonicalName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ingredient.count({ where }),
  ]);

  // A separate groupBy rather than a nested relation select — this only
  // needs distinct unit strings per ingredient, not one row per (of
  // potentially hundreds of) RecipeIngredient usages.
  const unitRows = await prisma.recipeIngredient.groupBy({
    by: ["ingredientId", "unit"],
    where: { ingredientId: { in: ingredients.map((i) => i.id) }, unit: { not: null } },
  });
  const unitsByIngredientId = new Map<string, string[]>();
  for (const row of unitRows) {
    if (!row.unit) continue;
    const list = unitsByIngredientId.get(row.ingredientId);
    if (list) list.push(row.unit);
    else unitsByIngredientId.set(row.ingredientId, [row.unit]);
  }

  const rows: IngredientReviewRow[] = ingredients.map((i) => ({
    id: i.id,
    canonicalName: i.canonicalName,
    category: i.category,
    packagedUnit: i.packagedUnit,
    packagedUnitQuantity: i.packagedUnitQuantity,
    packagedUnitBase: i.packagedUnitBase,
    shoppingListNote: i.shoppingListNote,
    usageCount: i._count.recipeIngredients,
    unitsSeen: (unitsByIngredientId.get(i.id) ?? []).sort(),
  }));

  return { rows, total, page, pageSize };
}
