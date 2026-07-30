"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function toggleFavourite(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({
    where: { id: recipeId },
    select: { isFavourite: true },
  });
  await prisma.recipe.update({
    where: { id: recipeId },
    data: { isFavourite: !recipe.isFavourite },
  });
  // Favourite state can be visible from any route (card grid, detail page,
  // suggest page), so revalidate broadly rather than tracking every caller.
  revalidatePath("/", "layout");
}
