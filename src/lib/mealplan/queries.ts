import { prisma } from "@/lib/db";

/**
 * This is a personal, single-user app with no auth, so there's just one
 * implicit "current" plan rather than named/multiple saved plans — created
 * lazily on first use.
 */
export async function getOrCreateCurrentMealPlan() {
  const existing = await prisma.mealPlan.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.mealPlan.create({ data: { label: "This week" } });
}

export interface PlannedRecipe {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  imageUrl: string | null;
  /** The recipe's own scraped serving count (always 2 for this catalog, but not hardcoded). */
  baseServings: number | null;
  /** Per-plan override from MealPlanRecipe.servings — null means "use baseServings". */
  planServings: number | null;
}

export async function getCurrentPlanRecipes(): Promise<PlannedRecipe[]> {
  const plan = await getOrCreateCurrentMealPlan();
  const rows = await prisma.mealPlanRecipe.findMany({
    where: { mealPlanId: plan.id },
    select: {
      servings: true,
      recipe: { select: { id: true, slug: true, name: true, subtitle: true, imageUrl: true, servings: true } },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({
    id: r.recipe.id,
    slug: r.recipe.slug,
    name: r.recipe.name,
    subtitle: r.recipe.subtitle,
    imageUrl: r.recipe.imageUrl,
    baseServings: r.recipe.servings,
    planServings: r.servings,
  }));
}

/** Just the recipe ids currently planned, for cheaply checking "is this recipe already in the plan" while rendering cards. */
export async function getCurrentPlanRecipeIds(): Promise<Set<string>> {
  const plan = await getOrCreateCurrentMealPlan();
  const rows = await prisma.mealPlanRecipe.findMany({
    where: { mealPlanId: plan.id },
    select: { recipeId: true },
  });
  return new Set(rows.map((r) => r.recipeId));
}
