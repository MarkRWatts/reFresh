export interface RecipeStep {
  text: string;
  imageUrl: string | null;
  caption: string | null;
}

/** Safely narrows the Recipe.steps Json column into typed steps for rendering. */
export function parseRecipeSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RecipeStep =>
      !!item && typeof item === "object" && typeof (item as RecipeStep).text === "string",
  );
}
