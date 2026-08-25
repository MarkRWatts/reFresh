import { prisma } from "@/lib/db";

/** One implicit "current" plan per household — created lazily on first use, same single-implicit-plan pattern as before households existed, just re-scoped. */
export async function getOrCreateCurrentMealPlan(householdId: string) {
  const existing = await prisma.mealPlan.findFirst({
    where: { householdId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.mealPlan.create({ data: { label: "This week", householdId } });
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

export async function getCurrentPlanRecipes(householdId: string): Promise<PlannedRecipe[]> {
  const plan = await getOrCreateCurrentMealPlan(householdId);
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
export async function getCurrentPlanRecipeIds(householdId: string): Promise<Set<string>> {
  const plan = await getOrCreateCurrentMealPlan(householdId);
  const rows = await prisma.mealPlanRecipe.findMany({
    where: { mealPlanId: plan.id },
    select: { recipeId: true },
  });
  return new Set(rows.map((r) => r.recipeId));
}
