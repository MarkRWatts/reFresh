import type { IngredientCategory } from "@/generated/prisma/client";

export type IngredientSortOption = "usage_desc" | "usage_asc" | "name_asc" | "category_asc";

export const INGREDIENT_SORT_OPTIONS: { value: IngredientSortOption; label: string }[] = [
  { value: "usage_desc", label: "Most used" },
  { value: "usage_asc", label: "Least used" },
  { value: "name_asc", label: "Name A→Z" },
  { value: "category_asc", label: "Category" },
];

export const INGREDIENT_CATEGORY_OPTIONS: { value: IngredientCategory; label: string }[] = [
  { value: "PRODUCE", label: "Produce" },
  { value: "PROTEIN", label: "Protein" },
  { value: "DAIRY", label: "Dairy" },
  { value: "PANTRY", label: "Pantry" },
  { value: "HERB_SPICE", label: "Herb / spice" },
  { value: "SAUCE_CONDIMENT", label: "Sauce / condiment" },
  { value: "GRAIN_STARCH", label: "Grain / starch" },
  { value: "OTHER", label: "Other" },
];

export interface IngredientReviewRow {
  id: string;
  canonicalName: string;
  category: IngredientCategory;
  packagedUnit: string | null;
  packagedUnitQuantity: number | null;
  packagedUnitBase: string | null;
  packagedUnitBaseGrams: number | null;
  shoppingListNote: string | null;
  /** Uses in recipes that actually appear in the app (isBrowsable) — see listIngredientsForReview. */
  usageCount: number;
  /** Every RecipeIngredient row regardless of the recipe's browsable status — shown alongside usageCount only when they differ, so a reviewer can see how much of an ingredient's apparent frequency is HelloFresh dead weight (draft/test/removed recipes) rather than real usage. */
  totalUsageCount: number;
  /** Distinct raw RecipeIngredient.unit values seen for this ingredient — shown as suggestions so the reviewer doesn't have to cross-reference actual recipes to know what to type into packagedUnit. */
  unitsSeen: string[];
}
