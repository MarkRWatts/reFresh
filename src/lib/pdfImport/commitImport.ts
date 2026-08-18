"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolveIngredientId } from "@/lib/recipes/ingredientResolution";
import { numberField, readEditedIngredients, readEditedSteps } from "@/lib/recipes/formFields";
import { classifyProteinType } from "@/lib/scraper/proteinType";
import { slugify, uniqueSlug } from "@/lib/recipes/slug";
import { promoteDraftImages } from "./imageStorage";
import type { DraftRecipeData } from "./parseCardPdf";

/**
 * Turns a reviewed-and-edited PDF import draft into a real, browsable
 * Recipe. Unlike upsertRecipe.ts (the website scraper's counterpart), this
 * always creates rather than upserts — a PDF import has no stable external
 * id to key off, so re-importing the same card just makes a second recipe
 * (same as re-uploading a photo would).
 */
export async function commitPdfImportDraft(draftId: string, formData: FormData): Promise<void> {
  const draft = await prisma.pdfImportDraft.findUniqueOrThrow({ where: { id: draftId } });
  const data = draft.data as unknown as DraftRecipeData;

  const name = String(formData.get("name") ?? "").trim() || "Untitled recipe";
  const subtitle = String(formData.get("subtitle") ?? "").trim() || null;
  const cookMinutes = numberField(formData, "cookMinutes");
  const servingIndex = Number(formData.get("servingIndex") ?? 0);
  const servings = data.servingCounts[servingIndex] ?? data.servingCounts[0] ?? null;

  const ingredients = readEditedIngredients(formData);
  const proteinType = classifyProteinType({
    ingredientNames: ingredients.map((i) => i.name),
    name,
  });

  const slug = await uniqueSlug(slugify(name));
  const hfId = `pdf-${crypto.randomUUID()}`;

  const recipe = await prisma.recipe.create({
    data: {
      hfId,
      slug,
      name,
      subtitle,
      sourceUrl: null,
      cookMinutes,
      servings,
      calories: numberField(formData, "calories"),
      fatGrams: numberField(formData, "fatGrams"),
      saturatedFatGrams: numberField(formData, "saturatedFatGrams"),
      carbsGrams: numberField(formData, "carbsGrams"),
      sugarGrams: numberField(formData, "sugarGrams"),
      proteinGrams: numberField(formData, "proteinGrams"),
      saltGrams: numberField(formData, "saltGrams"),
      fiberGrams: numberField(formData, "fiberGrams"),
      proteinType,
      steps: [] as unknown as Prisma.InputJsonValue,
      isBrowsable: true,
      isUserCreated: true,
      isPdfImport: true,
    },
  });

  // Images live under the draft's id until now — move them into the new
  // recipe's own folder and point the recipe at their final URLs.
  const { coverImageUrl, stepImageUrls } = await promoteDraftImages(draftId, recipe.id);
  const steps = readEditedSteps(formData, stepImageUrls).map((s) => ({
    text: s.heading ? `${s.heading}\n\n${s.text}` : s.text,
    imageUrl: s.imageUrl,
    caption: null,
  }));

  await prisma.recipe.update({
    where: { id: recipe.id },
    data: {
      imageUrl: coverImageUrl,
      steps: steps as unknown as Prisma.InputJsonValue,
    },
  });

  for (const ingredient of ingredients) {
    const ingredientId = await resolveIngredientId(ingredient.name);
    const rawText = [ingredient.quantity, ingredient.unit, ingredient.name].filter(Boolean).join(" ");
    await prisma.recipeIngredient.create({
      data: {
        recipeId: recipe.id,
        ingredientId,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        rawText,
      },
    });
  }

  await prisma.pdfImportDraft.delete({ where: { id: draftId } });

  revalidatePath("/", "layout");
  redirect(`/recipes/${recipe.slug}`);
}
