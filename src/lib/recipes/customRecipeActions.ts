"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { classifyProteinType } from "@/lib/scraper/proteinType";
import { slugify, uniqueSlug } from "./slug";

/**
 * Duplicates a recipe (and its ingredients) into a new editable copy, then
 * sends the user straight to the full editor for it (see
 * recipeEditActions.ts) — the recipe-authoring equivalent of a fork.
 * Nutrition/steps/ingredients all start out copied as-is from the source,
 * editable from there.
 */
export async function cloneRecipe(sourceRecipeId: string): Promise<void> {
  const source = await prisma.recipe.findUniqueOrThrow({
    where: { id: sourceRecipeId },
    include: { ingredients: true },
  });

  const slug = await uniqueSlug(`${slugify(source.name)}-custom`);

  const clone = await prisma.recipe.create({
    data: {
      hfId: `custom-${crypto.randomUUID()}`,
      slug,
      name: `${source.name} (Custom)`,
      subtitle: source.subtitle,
      description: source.description,
      imageUrl: source.imageUrl,
      sourceUrl: source.sourceUrl,
      cookMinutes: source.cookMinutes,
      servings: source.servings,
      calories: source.calories,
      fatGrams: source.fatGrams,
      saturatedFatGrams: source.saturatedFatGrams,
      carbsGrams: source.carbsGrams,
      sugarGrams: source.sugarGrams,
      proteinGrams: source.proteinGrams,
      fiberGrams: source.fiberGrams,
      saltGrams: source.saltGrams,
      proteinType: source.proteinType,
      cuisine: source.cuisine,
      category: source.category,
      steps: source.steps as Prisma.InputJsonValue,
      isBrowsable: true,
      isUserCreated: true,
      clonedFromId: source.id,
      ingredients: {
        create: source.ingredients.map((ri) => ({
          ingredientId: ri.ingredientId,
          quantity: ri.quantity,
          unit: ri.unit,
          rawText: ri.rawText,
        })),
      },
    },
  });

  revalidatePath("/", "layout");
  redirect(`/recipes/${clone.slug}/edit`);
}

/** Re-derives proteinType from a recipe's current ingredient list — called after every ingredient edit so the badge/filter stay meaningful post-edit (see also recipeEditActions.ts's updateRecipeFields). */
export async function refreshProteinType(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  const ingredients = await prisma.recipeIngredient.findMany({
    where: { recipeId },
    include: { ingredient: true },
  });
  const proteinType = classifyProteinType({
    ingredientNames: ingredients.map((i) => i.ingredient.canonicalName),
    name: recipe.name,
    category: recipe.category ?? undefined,
    cuisine: recipe.cuisine ?? undefined,
  });
  await prisma.recipe.update({ where: { id: recipeId }, data: { proteinType } });
}

