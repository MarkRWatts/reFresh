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
} satisfies Prisma.RecipeSelect;

export type RecipeSummary = Prisma.RecipeGetPayload<{ select: typeof RECIPE_SUMMARY_SELECT }>;

function buildWhere(params: RecipeListParams): Prisma.RecipeWhereInput {
  // A handful of scraped entries (empty/legacy stub pages, ~3% of the
  // catalog) have zero ingredients. They're useless for this app's whole
  // point — nothing to share across a meal plan — and with no ingredient
  // text to inspect, the protein-type classifier can only ever return
  // UNKNOWN for them too. Excluded from the default browse view; still
  // reachable directly by URL if a future re-scrape fills them in.
  const where: Prisma.RecipeWhereInput = {
    ingredients: { some: {} },
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

  return where;
}

function buildOrderBy(sort: SortOption | undefined): Prisma.RecipeOrderByWithRelationInput {
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

export type RecipeDetail = Prisma.RecipeGetPayload<{
  include: { ingredients: { include: { ingredient: true } } };
}>;

/** Full recipe detail — ingredients (with canonical names) + instructions — for the detail view. */
export async function getRecipeBySlug(slug: string): Promise<RecipeDetail | null> {
  return prisma.recipe.findUnique({
    where: { slug },
    include: { ingredients: { include: { ingredient: true } } },
  });
}
