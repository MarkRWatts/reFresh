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
  /** Shows only this household's hidden recipes instead of excluding them — see toggleHidden in hiddenActions.ts. The one place a hidden recipe can be found again to unhide it. */
  hiddenOnly?: boolean;
  showAll?: boolean;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 24;

// Favourite/hidden state moved off Recipe into a per-household join table
// (HouseholdRecipeState — see prisma/schema.prisma and project-plan.md
// Phase 16), since the recipe catalog itself is shared across households.
// This select pulls just this household's row (at most one, per its unique
// constraint) so the result can be flattened back to flat
// isFavourite/isHidden booleans — see flattenSummary below — keeping every
// downstream component (RecipeCard, the toggle buttons, ...) unchanged.
function recipeSummarySelect(householdId: string) {
  return {
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
    isUserCreated: true,
    isPdfImport: true,
    householdStates: {
      where: { householdId },
      select: { isFavourite: true, isHidden: true },
    },
  } satisfies Prisma.RecipeSelect;
}

type RecipeSummaryRaw = Prisma.RecipeGetPayload<{ select: ReturnType<typeof recipeSummarySelect> }>;

export type RecipeSummary = Omit<RecipeSummaryRaw, "householdStates"> & {
  isFavourite: boolean;
  isHidden: boolean;
};

function flattenSummary({ householdStates, ...rest }: RecipeSummaryRaw): RecipeSummary {
  const state = householdStates[0];
  return { ...rest, isFavourite: state?.isFavourite ?? false, isHidden: state?.isHidden ?? false };
}

export function buildWhere(params: RecipeListParams, householdId: string): Prisma.RecipeWhereInput {
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
  };

  const householdConditions: Prisma.RecipeWhereInput[] = [
    // Hidden-by-this-household recipes drop out of every default view
    // (browse, suggest) the same way non-browsable ones do — except the
    // hidden-recipes filter itself, which needs to show exactly the
    // opposite so a hidden recipe can be found again and unhidden.
    params.hiddenOnly
      ? { householdStates: { some: { householdId, isHidden: true } } }
      : { householdStates: { none: { householdId, isHidden: true } } },
  ];
  if (params.favouritesOnly) {
    householdConditions.push({ householdStates: { some: { householdId, isFavourite: true } } });
  }
  where.AND = householdConditions;

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
export async function listRecipes(
  params: RecipeListParams,
  householdId: string,
): Promise<RecipeListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = buildWhere(params, householdId);

  const [recipes, total] = await Promise.all([
    prisma.recipe.findMany({
      where,
      select: recipeSummarySelect(householdId),
      orderBy: buildOrderBy(params.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.recipe.count({ where }),
  ]);

  return { recipes: recipes.map(flattenSummary), total, page, pageSize };
}

export interface RecipeIngredientSetForSuggestion {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  ratingValue: number | null;
  ingredientIds: string[];
}

// How long a recipe sits out of a household's suggestion pool after
// appearing in one of its /suggest results — long enough that "suggest a
// week" doesn't just show the same handful of top-rated recipes on every
// visit, short enough that a heavily-filtered pool doesn't run dry. See
// listRecipeIngredientSetsForSuggestion.
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
 * Excludes recipes recently suggested to this household (see
 * SUGGESTION_COOLDOWN_DAYS) by default — pass `excludeRecentlySuggested:
 * false` to opt out, which the caller does as a fallback when the
 * exclusion would leave too small a pool to suggest from (see
 * suggest/page.tsx).
 */
export async function listRecipeIngredientSetsForSuggestion(
  params: RecipeListParams,
  householdId: string,
  cap = 400,
  { excludeRecentlySuggested = true }: { excludeRecentlySuggested?: boolean } = {},
): Promise<RecipeIngredientSetForSuggestion[]> {
  const where = buildWhere(params, householdId);
  if (excludeRecentlySuggested) {
    const cutoff = new Date(Date.now() - SUGGESTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [
      ...existingAnd,
      { householdStates: { none: { householdId, lastSuggestedAt: { gte: cutoff } } } },
    ];
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

/** Stamps lastSuggestedAt (for this household) on every recipe that appeared in a /suggest result — not just the option the user picks, since the bug this exists to fix (the same recipes repeating) is about what gets *shown*, not what gets chosen. See listRecipeIngredientSetsForSuggestion's cooldown exclusion. */
export async function markRecipesSuggested(recipeIds: string[], householdId: string): Promise<void> {
  if (recipeIds.length === 0) return;
  const now = new Date();
  for (const recipeId of recipeIds) {
    await prisma.householdRecipeState.upsert({
      where: { householdId_recipeId: { householdId, recipeId } },
      create: { householdId, recipeId, lastSuggestedAt: now },
      update: { lastSuggestedAt: now },
    });
  }
}

export interface RecipeMatch {
  recipe: RecipeSummary;
  /** How many of the recipe's ingredients are in the user's set. */
  matchCount: number;
  /** Total ingredients the recipe uses. */
  totalCount: number;
  /** Canonical names of the recipe's ingredients NOT in the user's set, alphabetical. */
  missingIngredientNames: string[];
}

export interface RecipeMatchResult {
  matches: RecipeMatch[];
  /** Size of the candidate pool before the results cap — lets the caller note "showing N of M". */
  poolSize: number;
}

// Loaded in full (like listRecipeIngredientSetsForSuggestion's pool) rather
// than scored in SQL — coverage math is simplest done in JS once a recipe's
// ingredient set is in memory, and buildWhere already narrows the query to
// recipes that use at least one selected ingredient, so this pool is small.
const MATCH_POOL_CAP = 1000;
const MATCH_RESULTS_CAP = 60;

/**
 * Ranks recipes by how much of their ingredient list is covered by
 * `ingredientIds` (the "what can I make?" pantry-match page) — highest
 * coverage first, ties broken by fewest missing ingredients then rating.
 * Reuses buildWhere so pantry matches respect whatever protein/cuisine/
 * time/calorie filters are active, same as /suggest's candidate pool.
 * Recipes that don't use any of the given ingredients are excluded outright
 * rather than ranked last, since a 0% match isn't a useful suggestion.
 */
export async function matchRecipesByIngredients(
  ingredientIds: string[],
  params: RecipeListParams,
  householdId: string,
): Promise<RecipeMatchResult> {
  if (ingredientIds.length === 0) return { matches: [], poolSize: 0 };

  const haveIds = new Set(ingredientIds);
  const where = buildWhere(params, householdId);
  where.ingredients = { some: { ingredientId: { in: ingredientIds } } };

  const recipes = await prisma.recipe.findMany({
    where,
    select: {
      ...recipeSummarySelect(householdId),
      ingredients: { select: { ingredient: { select: { id: true, canonicalName: true } } } },
    },
    take: MATCH_POOL_CAP,
  });

  const matches: RecipeMatch[] = recipes.map(({ ingredients, ...raw }) => {
    const missing = ingredients.filter((i) => !haveIds.has(i.ingredient.id));
    return {
      recipe: flattenSummary(raw),
      matchCount: ingredients.length - missing.length,
      totalCount: ingredients.length,
      missingIngredientNames: missing.map((i) => i.ingredient.canonicalName).sort(),
    };
  });

  matches.sort((a, b) => {
    const coverageA = a.totalCount > 0 ? a.matchCount / a.totalCount : 0;
    const coverageB = b.totalCount > 0 ? b.matchCount / b.totalCount : 0;
    if (coverageA !== coverageB) return coverageB - coverageA;
    if (a.missingIngredientNames.length !== b.missingIngredientNames.length) {
      return a.missingIngredientNames.length - b.missingIngredientNames.length;
    }
    return (b.recipe.ratingValue ?? 0) - (a.recipe.ratingValue ?? 0);
  });

  return { matches: matches.slice(0, MATCH_RESULTS_CAP), poolSize: matches.length };
}

/** Resolves ingredient ids (e.g. from the `?ingredients=` URL param) to their canonical names, for rendering chips — silently drops any id that no longer exists. */
export async function getIngredientsByIds(
  ids: string[],
): Promise<{ id: string; canonicalName: string }[]> {
  if (ids.length === 0) return [];
  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ids } },
    select: { id: true, canonicalName: true },
  });
  // Preserve URL order rather than whatever order the DB returns, so chips
  // don't reshuffle as the user adds more.
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  return ids.map((id) => byId.get(id)).filter((i): i is { id: string; canonicalName: string } => i != null);
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

function recipeDetailInclude(householdId: string) {
  return {
    ingredients: { include: { ingredient: true } },
    variants: { select: VARIANT_SUMMARY_SELECT },
    householdStates: {
      where: { householdId },
      select: { isFavourite: true, isHidden: true },
    },
  } satisfies Prisma.RecipeInclude;
}

type RecipeDetailRaw = Prisma.RecipeGetPayload<{ include: ReturnType<typeof recipeDetailInclude> }>;

export type RecipeDetail = Omit<RecipeDetailRaw, "householdStates"> & {
  isFavourite: boolean;
  isHidden: boolean;
};

/** Full recipe detail — ingredients (with canonical names), instructions, this household's favourite/hidden state, and any detected near-duplicate variants — for the detail view. */
export async function getRecipeBySlug(slug: string, householdId: string): Promise<RecipeDetail | null> {
  const recipe = await prisma.recipe.findUnique({
    where: { slug },
    include: recipeDetailInclude(householdId),
  });
  if (!recipe) return null;
  const { householdStates, ...rest } = recipe;
  const state = householdStates[0];
  return { ...rest, isFavourite: state?.isFavourite ?? false, isHidden: state?.isHidden ?? false };
}
