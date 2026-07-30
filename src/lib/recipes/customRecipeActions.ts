"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolveIngredientId } from "./ingredientResolution";
import { classifyProteinType } from "@/lib/scraper/proteinType";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 2;
  while (await prisma.recipe.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

/**
 * Duplicates a recipe (and its ingredients) into a new editable copy, then
 * sends the user straight to the ingredient editor for it — the
 * recipe-authoring equivalent of a fork. Nutrition/steps/etc. are copied
 * as-is from the source; only ingredients are editable in this first cut.
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

/** Re-derives proteinType from a recipe's current ingredient list — called after every add/remove so the badge/filter stay meaningful post-edit. */
async function refreshProteinType(recipeId: string): Promise<void> {
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

export async function addCustomIngredient(recipeId: string, formData: FormData): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  if (!recipe.isUserCreated) throw new Error("Only custom recipes can be edited");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim() || null;
  const quantity = quantityRaw ? Number(quantityRaw) : null;

  const ingredientId = await resolveIngredientId(name);
  const rawText = [quantityRaw, unit, name].filter(Boolean).join(" ");

  await prisma.recipeIngredient.create({
    data: {
      recipeId,
      ingredientId,
      quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
      unit,
      rawText,
    },
  });

  await refreshProteinType(recipeId);
  revalidatePath(`/recipes/${recipe.slug}/edit`);
  revalidatePath(`/recipes/${recipe.slug}`);
}

export async function removeCustomIngredient(recipeIngredientId: string): Promise<void> {
  const ri = await prisma.recipeIngredient.findUniqueOrThrow({
    where: { id: recipeIngredientId },
    include: { recipe: true },
  });
  if (!ri.recipe.isUserCreated) throw new Error("Only custom recipes can be edited");

  await prisma.recipeIngredient.delete({ where: { id: recipeIngredientId } });
  await refreshProteinType(ri.recipeId);

  revalidatePath(`/recipes/${ri.recipe.slug}/edit`);
  revalidatePath(`/recipes/${ri.recipe.slug}`);
}
