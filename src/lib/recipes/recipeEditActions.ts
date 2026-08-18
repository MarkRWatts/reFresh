"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { refreshProteinType } from "./customRecipeActions";
import { resolveIngredientId } from "./ingredientResolution";
import { numberField, readEditedIngredients, readEditedSteps } from "./formFields";
import { parseRecipeSteps } from "./steps";
import { deleteRecipeImages, saveRecipeCoverPhoto } from "@/lib/pdfImport/imageStorage";

/**
 * Saves a full edit — name/cook time/nutrition/ingredients/steps/cover
 * photo — over an existing custom or PDF-imported recipe. The same
 * field-reading conventions as the PDF import review form (see
 * commitImport.ts): an ingredient row is dropped by clearing its name, a
 * step by clearing its text, and a step's own photo (there's no per-step
 * upload widget yet) just carries through unchanged from whatever it
 * already was.
 */
export async function updateRecipeFields(recipeId: string, formData: FormData): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  if (!recipe.isUserCreated) throw new Error("Only custom recipes can be edited");

  const name = String(formData.get("name") ?? "").trim() || recipe.name;
  const subtitle = String(formData.get("subtitle") ?? "").trim() || null;
  const cookMinutes = numberField(formData, "cookMinutes");

  const existingStepImageUrls = parseRecipeSteps(recipe.steps).map((s) => s.imageUrl);
  const steps = readEditedSteps(formData, existingStepImageUrls).map((s) => ({
    heading: s.heading || null,
    text: s.text,
    imageUrl: s.imageUrl,
    caption: null,
  }));

  const ingredients = readEditedIngredients(formData);

  const coverPhoto = formData.get("coverPhoto");
  const imageUrl =
    coverPhoto instanceof File && coverPhoto.size > 0
      ? await saveRecipeCoverPhoto(recipeId, Buffer.from(await coverPhoto.arrayBuffer()), coverPhoto.type)
      : undefined;

  await prisma.$transaction([
    prisma.recipeIngredient.deleteMany({ where: { recipeId } }),
    prisma.recipe.update({
      where: { id: recipeId },
      data: {
        name,
        subtitle,
        cookMinutes,
        calories: numberField(formData, "calories"),
        fatGrams: numberField(formData, "fatGrams"),
        saturatedFatGrams: numberField(formData, "saturatedFatGrams"),
        carbsGrams: numberField(formData, "carbsGrams"),
        sugarGrams: numberField(formData, "sugarGrams"),
        proteinGrams: numberField(formData, "proteinGrams"),
        saltGrams: numberField(formData, "saltGrams"),
        fiberGrams: numberField(formData, "fiberGrams"),
        steps: steps as unknown as Prisma.InputJsonValue,
        ...(imageUrl ? { imageUrl } : {}),
      },
    }),
  ]);

  for (const ingredient of ingredients) {
    const ingredientId = await resolveIngredientId(ingredient.name);
    const rawText = [ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
    await prisma.recipeIngredient.create({
      data: { recipeId, ingredientId, quantity: ingredient.quantity, unit: ingredient.unit, rawText },
    });
  }

  await refreshProteinType(recipeId);

  revalidatePath("/", "layout");
  redirect(`/recipes/${recipe.slug}`);
}

/**
 * Permanently deletes a custom or PDF-imported recipe. Its RecipeIngredient
 * rows and any MealPlanRecipe memberships cascade at the database level
 * (see schema.prisma's onDelete: Cascade on both relations) — nothing to
 * clean up there manually. clonedFromId/variantOfId aren't a concern
 * either: only isUserCreated recipes are deletable, and nothing in the UI
 * lets you clone or vary a recipe that's already isUserCreated, so no other
 * row can be pointing at this one through those fields.
 */
export async function deleteRecipe(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  if (!recipe.isUserCreated) throw new Error("Only custom recipes can be deleted");

  await prisma.recipe.delete({ where: { id: recipeId } });
  await deleteRecipeImages(recipeId);

  revalidatePath("/", "layout");
  redirect("/");
}
