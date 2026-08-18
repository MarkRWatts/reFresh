import { prisma } from "@/lib/db";
import type { Prisma, ProteinType } from "@/generated/prisma/client";

export type SortOption = "rating" | "calories" | "cookMinutes" | "recent";

export interface RecipeListParams {
  proteinTypes?: ProteinType[];
  cuisine?: string;
  minCalories?: number;
  maxCalories?: number;
  minCookMinutes?: number;
  maxCookMinutes?: number;
  search?: string;
  favouritesOnly?: boolean;
  importedOnly?: boolean;
  /** Shows only user-hidden recipes instead of excluding them — see toggleHidden in hiddenActions.ts. The one place a hidden recipe can be found again to unhide it. */
  hiddenOnly?: boolean;
  showAll?: boolean;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 24;

const RECIPE_SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  subtitle: true,
  imageUrl: true,
  cookMinutes: true,
  calories: true,
  proteinType: true,
  cuisine: true,
  ratingValue: true,
  ratingCount: true,
  isFavourite: true,
  isUserCreated: true,
  isPdfImport: true,
  isHidden: true,
} satisfies Prisma.RecipeSelect;

export type RecipeSummary = Prisma.RecipeGetPayload<{ select: typeof RECIPE_SUMMARY_SELECT }>;

export function buildWhere(params: RecipeListParams): Prisma.RecipeWhereInput {
  // Excludes scraped entries that aren't really a cookable recipe (see
  // isBrowsable's definition on the Recipe model for the exact rule) —
  // always applied, since those aren't a "similar recipe," they're broken
  // data. Non-primary members of a detected near-duplicate cluster (see
  // variantOfId's definition) are excluded too, UNLESS showAll is set, in
  // which case variants appear alongside their primary instead of being
  // hidden. Both still reachable directly by URL either way; recomputed on
  // re-scrape / re-running detect-variants.
  const where: Prisma.RecipeWhereInput = {
    isBrowsable: true,
    ...(params.showAll ? {} : { variantOfId: null }),
    // Hidden recipes drop out of every default view (browse, suggest) the
    // same way non-browsable ones do — except the hidden-recipes filter
    // itself, which needs to show exactly the opposite so a hidden recipe
    // can be found again and unhidden.
    isHidden: params.hiddenOnly ? true : false,
  };

  if (params.proteinTypes && params.proteinTypes.length > 0) {
    where.proteinType = { in: params.proteinTypes };
  }
  if (params.cuisine) {
    where.cuisine = { equals: params.cuisine, mode: "insensitive" };
  }
  if (params.minCalories != null || params.maxCalories != null) {
    where.calories = {
      ...(params.minCalories != null ? { gte: params.minCalories } : {}),
      ...(params.maxCalories != null ? { lte: params.maxCalories } : {}),
    };
  }
  if (params.minCookMinutes != null || params.maxCookMinutes != null) {
    where.cookMinutes = {
      ...(params.minCookMinutes != null ? { gte: params.minCookMinutes } : {}),
      ...(params.maxCookMinutes != null ? { lte: params.maxCookMinutes } : {}),
    };
  }
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { subtitle: { contains: params.search, mode: "insensitive" } },
    ];
  }
  if (params.favouritesOnly) {
    where.isFavourite = true;
  }
  if (params.importedOnly) {
    where.isPdfImport = true;
  }

  return where;
}

// A secondary sort on the unique `id` breaks ties deterministically — without
// it, rows with equal sort values (e.g. many recipes sharing a rating) have
// no guaranteed order across separate skip/take queries, so the same recipe
// can shuffle onto multiple pages as you paginate.
function buildOrderBy(sort: SortOption | undefined): Prisma.RecipeOrderByWithRelationInput[] {
  const primary: Prisma.RecipeOrderByWithRelationInput = (() => {
    switch (sort) {
      case "calories":
        return { calories: "asc" };
      case "cookMinutes":
        return { cookMinutes: "asc" };
      case "recent":
        return { createdAt: "desc" };
      case "rating":
      default:
        return { ratingValue: "desc" };
    }
  })();
  return [primary, { id: "asc" }];
}

export interface RecipeListResult {
  recipes: RecipeSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Filtered, paginated recipe list for the card browser. */
export async function listRecipes(params: RecipeListParams = {}): Promise<RecipeListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = buildWhere(params);

  const [recipes, total] = await Promise.all([
    prisma.recipe.findMany({
      where,
      select: RECIPE_SUMMARY_SELECT,
      orderBy: buildOrderBy(params.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.recipe.count({ where }),
  ]);

  return { recipes, total, page, pageSize };
}

export interface RecipeIngredientSetForSuggestion {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  ratingValue: number | null;
  ingredientIds: string[];
}

// How long a recipe sits out of the suggestion pool after appearing in a
// /suggest result — long enough that "suggest a week" doesn't just show the
// same handful of top-rated recipes on every visit, short enough that a
// heavily-filtered pool doesn't run dry. See listRecipeIngredientSetsForSuggestion.
const SUGGESTION_COOLDOWN_DAYS = 14;

/**
 * The candidate pool for the auto-suggest optimizer: every recipe
 * matching the given filters (reusing the exact same buildWhere as the
 * browse grid, so "suggest a week" naturally scopes to whatever the user
 * was already filtering by), with its canonical ingredient ids attached.
 * Unpaginated but capped — a few hundred candidates is already enough for
 * the greedy optimizer to find good combinations, and this needs to load
 * entirely into memory to run.
 *
 * Excludes recently-suggested recipes (see SUGGESTION_COOLDOWN_DAYS) by
 * default — pass `excludeRecentlySuggested: false` to opt out, which the
 * caller does as a fallback when the exclusion would leave too small a pool
 * to suggest from (see suggest/page.tsx).
 */
export async function listRecipeIngredientSetsForSuggestion(
  params: RecipeListParams,
  cap = 400,
  { excludeRecentlySuggested = true }: { excludeRecentlySuggested?: boolean } = {},
): Promise<RecipeIngredientSetForSuggestion[]> {
  const where = buildWhere(params);
  if (excludeRecentlySuggested) {
    const cutoff = new Date(Date.now() - SUGGESTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { OR: [{ lastSuggestedAt: null }, { lastSuggestedAt: { lt: cutoff } }] }];
  }
  const recipes = await prisma.recipe.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      ratingValue: true,
      ingredients: { select: { ingredientId: true } },
    },
    orderBy: { ratingValue: "desc" },
    take: cap,
  });

  return recipes.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    imageUrl: r.imageUrl,
    ratingValue: r.ratingValue,
    ingredientIds: r.ingredients.map((i) => i.ingredientId),
  }));
}

/** Stamps lastSuggestedAt on every recipe that appeared in a /suggest result — not just the option the user picks, since the bug this exists to fix (the same recipes repeating) is about what gets *shown*, not what gets chosen. See listRecipeIngredientSetsForSuggestion's cooldown exclusion. */
export async function markRecipesSuggested(recipeIds: string[]): Promise<void> {
  if (recipeIds.length === 0) return;
  await prisma.recipe.updateMany({
    where: { id: { in: recipeIds } },
    data: { lastSuggestedAt: new Date() },
  });
}

/** Distinct cuisine values present in the DB, for populating a cuisine filter. */
export async function listCuisines(): Promise<string[]> {
  const rows = await prisma.recipe.findMany({
    where: { cuisine: { not: null } },
    select: { cuisine: true },
    distinct: ["cuisine"],
    orderBy: { cuisine: "asc" },
  });
  return rows.map((r) => r.cuisine).filter((c): c is string => c !== null);
}

const VARIANT_SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  subtitle: true,
} satisfies Prisma.RecipeSelect;

export type RecipeDetail = Prisma.RecipeGetPayload<{
  include: {
    ingredients: { include: { ingredient: true } };
    variants: { select: typeof VARIANT_SUMMARY_SELECT };
  };
}>;

/** Full recipe detail — ingredients (with canonical names), instructions, and any detected near-duplicate variants — for the detail view. */
export async function getRecipeBySlug(slug: string): Promise<RecipeDetail | null> {
  return prisma.recipe.findUnique({
    where: { slug },
    include: {
      ingredients: { include: { ingredient: true } },
      variants: { select: VARIANT_SUMMARY_SELECT },
    },
  });
}
