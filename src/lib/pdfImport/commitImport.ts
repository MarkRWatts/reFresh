"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolveIngredientId } from "@/lib/recipes/ingredientResolution";
import { parseLeadingQuantity } from "@/lib/scraper/ingredientParser";
import { classifyProteinType } from "@/lib/scraper/proteinType";
import { slugify, uniqueSlug } from "@/lib/recipes/slug";
import { promoteDraftImages } from "./imageStorage";
import type { DraftRecipeData } from "./parseCardPdf";

function numberField(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

interface EditedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

function readEditedIngredients(formData: FormData): EditedIngredient[] {
  const names = formData.getAll("ingredientName");
  const quantities = formData.getAll("ingredientQuantity");
  const units = formData.getAll("ingredientUnit");
  const rows: EditedIngredient[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] ?? "").trim();
    if (!name) continue; // an emptied name field is how a row gets dropped on review
    const quantityRaw = String(quantities[i] ?? "").trim();
    rows.push({
      name,
      quantity: quantityRaw ? parseLeadingQuantity(quantityRaw) : null,
      unit: String(units[i] ?? "").trim() || null,
    });
  }
  return rows;
}

interface EditedStep {
  heading: string;
  text: string;
  imageUrl: string | null;
}

function readEditedSteps(formData: FormData, stepImageUrls: (string | null)[]): EditedStep[] {
  const headings = formData.getAll("stepHeading");
  const texts = formData.getAll("stepText");
  const steps: EditedStep[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] ?? "").trim();
    if (!text) continue;
    steps.push({
      heading: String(headings[i] ?? "").trim(),
      text,
      imageUrl: stepImageUrls[i] ?? null,
    });
  }
  return steps;
}

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
