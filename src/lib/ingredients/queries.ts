import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { IngredientReviewRow, IngredientSortOption } from "./types";

export type { IngredientReviewRow } from "./types";

export interface IngredientReviewParams {
  search?: string;
  sort?: IngredientSortOption;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;

function buildOrderBy(sort: IngredientSortOption | undefined): Prisma.IngredientOrderByWithRelationInput[] {
  switch (sort) {
    case "usage_asc":
      return [{ recipeIngredients: { _count: "asc" } }, { canonicalName: "asc" }];
    case "name_asc":
      return [{ canonicalName: "asc" }];
    case "category_asc":
      return [{ category: "asc" }, { canonicalName: "asc" }];
    case "usage_desc":
    default:
      return [{ recipeIngredients: { _count: "desc" } }, { canonicalName: "asc" }];
  }
}

export interface IngredientReviewResult {
  rows: IngredientReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated, searchable, sortable ingredient list for the one-time manual
 * review page (name/merge cleanup, category, packaged-unit sizing,
 * shopping-list substitution notes). Defaults to usage count descending
 * so the highest-impact ingredients (the ones appearing in the most
 * recipes) get reviewed first — see IngredientSortOption for the other
 * options, including ascending usage to surface the opposite end (rare,
 * likely-duplicate ingredients worth double-checking).
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
      orderBy: buildOrderBy(params.sort),
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
