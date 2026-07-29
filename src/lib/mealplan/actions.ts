"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getOrCreateCurrentMealPlan } from "./queries";

export async function addRecipeToPlan(recipeId: string): Promise<void> {
  const plan = await getOrCreateCurrentMealPlan();
  await prisma.mealPlanRecipe.upsert({
    where: { mealPlanId_recipeId: { mealPlanId: plan.id, recipeId } },
    create: { mealPlanId: plan.id, recipeId },
    update: {},
  });
  // The plan drawer and "in plan" card state can be visible from any
  // route, so revalidate broadly rather than trying to track every page
  // that might currently be rendering plan-derived data.
  revalidatePath("/", "layout");
}

export async function removeRecipeFromPlan(recipeId: string): Promise<void> {
  const plan = await getOrCreateCurrentMealPlan();
  await prisma.mealPlanRecipe.deleteMany({
    where: { mealPlanId: plan.id, recipeId },
  });
  revalidatePath("/", "layout");
}
