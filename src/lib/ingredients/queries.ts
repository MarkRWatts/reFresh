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

interface SortableRow {
  canonicalName: string;
  category: string;
  usageCount: number;
}

function compareRows(sort: IngredientSortOption | undefined, a: SortableRow, b: SortableRow): number {
  switch (sort) {
    case "usage_asc":
      return a.usageCount - b.usageCount || a.canonicalName.localeCompare(b.canonicalName);
    case "name_asc":
      return a.canonicalName.localeCompare(b.canonicalName);
    case "category_asc":
      return a.category.localeCompare(b.category) || a.canonicalName.localeCompare(b.canonicalName);
    case "usage_desc":
    default:
      return b.usageCount - a.usageCount || a.canonicalName.localeCompare(b.canonicalName);
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
 * shopping-list substitution notes). Defaults to usage count descending so
 * the highest-impact ingredients get reviewed first — see
 * IngredientSortOption for the other options, including ascending usage
 * to surface likely-duplicate stragglers.
 *
 * "Usage" here means recipes that would actually appear in the app
 * (isBrowsable, not isHidden — the same filter buildWhere applies to
 * browse/suggest/pantry-match), not a raw count of every scraped
 * RecipeIngredient row. HelloFresh's catalog carries a lot of dead weight
 * — draft/test/removed recipes that never show up anywhere a user would
 * actually see them (see Recipe.isBrowsable's doc comment) — and counting
 * those inflated even the most common ingredients by ~30% in a spot check
 * (e.g. "water": 9627 raw rows, only 6795 from a recipe anyone would ever
 * browse to). totalUsageCount carries the raw figure alongside so a
 * reviewer can see when the two diverge, rather than silently hiding it.
 * Sorted/paginated in memory rather than at the DB level — Prisma's
 * relation _count aggregation used for orderBy can't be given a filter,
 * and even the full ~1,400-ingredient catalog is trivial to sort in JS.
 */
export async function listIngredientsForReview(
  params: IngredientReviewParams = {},
): Promise<IngredientReviewResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  const where: Prisma.IngredientWhereInput = params.search
    ? { canonicalName: { contains: params.search, mode: "insensitive" } }
    : {};

  const [ingredients, realUsageCounts, totalUsageCounts] = await Promise.all([
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
      },
    }),
    prisma.recipeIngredient.groupBy({
      by: ["ingredientId"],
      where: { recipe: { isBrowsable: true, isHidden: false } },
      _count: { _all: true },
    }),
    prisma.recipeIngredient.groupBy({
      by: ["ingredientId"],
      _count: { _all: true },
    }),
  ]);

  const realUsageById = new Map(realUsageCounts.map((r) => [r.ingredientId, r._count._all]));
  const totalUsageById = new Map(totalUsageCounts.map((r) => [r.ingredientId, r._count._all]));

  const allRows = ingredients.map((i) => ({
    ...i,
    usageCount: realUsageById.get(i.id) ?? 0,
    totalUsageCount: totalUsageById.get(i.id) ?? 0,
  }));
  allRows.sort((a, b) => compareRows(params.sort, a, b));

  const total = allRows.length;
  const pageRows = allRows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // A separate groupBy rather than a nested relation select — this only
  // needs distinct unit strings per ingredient, not one row per (of
  // potentially hundreds of) RecipeIngredient usages. Only for the current
  // page's ingredients, unlike the usage counts above.
  const unitRows = await prisma.recipeIngredient.groupBy({
    by: ["ingredientId", "unit"],
    where: { ingredientId: { in: pageRows.map((i) => i.id) }, unit: { not: null } },
  });
  const unitsByIngredientId = new Map<string, string[]>();
  for (const row of unitRows) {
    if (!row.unit) continue;
    const list = unitsByIngredientId.get(row.ingredientId);
    if (list) list.push(row.unit);
    else unitsByIngredientId.set(row.ingredientId, [row.unit]);
  }

  const rows: IngredientReviewRow[] = pageRows.map((i) => ({
    id: i.id,
    canonicalName: i.canonicalName,
    category: i.category,
    packagedUnit: i.packagedUnit,
    packagedUnitQuantity: i.packagedUnitQuantity,
    packagedUnitBase: i.packagedUnitBase,
    shoppingListNote: i.shoppingListNote,
    usageCount: i.usageCount,
    totalUsageCount: i.totalUsageCount,
    unitsSeen: (unitsByIngredientId.get(i.id) ?? []).sort(),
  }));

  return { rows, total, page, pageSize };
}
