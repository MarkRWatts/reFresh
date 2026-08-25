"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMember } from "@/lib/require-member";

/** Toggles a recipe's hidden state for the signed-in household — same shape as favourites/actions.ts's toggleFavourite. Reversible (unlike deleting a custom/PDF recipe): a hidden recipe just drops out of buildWhere()'s default results (see queries.ts) until unhidden from the hidden-recipes filter. */
export async function toggleHidden(recipeId: string): Promise<void> {
  const { householdId } = await requireMember();

  const state = await prisma.householdRecipeState.findUnique({
    where: { householdId_recipeId: { householdId, recipeId } },
    select: { isHidden: true },
  });
  await prisma.householdRecipeState.upsert({
    where: { householdId_recipeId: { householdId, recipeId } },
    create: { householdId, recipeId, isHidden: true },
    update: { isHidden: !state?.isHidden },
  });
  revalidatePath("/", "layout");
}
