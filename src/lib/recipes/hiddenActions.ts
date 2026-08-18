"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

/** Toggles a recipe's isHidden flag — same shape as favourites/actions.ts's toggleFavourite. Reversible (unlike deleting a custom/PDF recipe): a hidden recipe just drops out of buildWhere()'s default results (see queries.ts) until unhidden from the hidden-recipes filter. */
export async function toggleHidden(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    select: { isHidden: true },
  });
  await prisma.recipe.update({
    where: { id: recipeId },
    data: { isHidden: !recipe.isHidden },
  });
  revalidatePath("/", "layout");
}
