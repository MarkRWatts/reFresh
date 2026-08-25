"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/require-member";

export async function toggleFavourite(recipeId: string): Promise<void> {
  const { householdId } = await requireMember();

  const state = await prisma.householdRecipeState.findUnique({
    where: { householdId_recipeId: { householdId, recipeId } },
    select: { isFavourite: true },
  });
  await prisma.householdRecipeState.upsert({
    where: { householdId_recipeId: { householdId, recipeId } },
    create: { householdId, recipeId, isFavourite: true },
    update: { isFavourite: !state?.isFavourite },
  });
  // Favourite state can be visible from any route (card grid, detail page,
  // suggest page), so revalidate broadly rather than tracking every caller.
  revalidatePath("/", "layout");
}
