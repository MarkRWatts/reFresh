export interface RecipeStep {
  heading: string | null;
  text: string;
  imageUrl: string | null;
  caption: string | null;
}

/** Safely narrows the Recipe.steps Json column into typed steps for rendering. `heading` defaults to null for older rows saved before it was tracked as its own field (it was flattened into the start of `text` instead — see commitImport.ts/recipeEditActions.ts's git history) rather than erroring on them. */
export function parseRecipeSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string")
    .map((item) => ({
      heading: typeof item.heading === "string" && item.heading ? item.heading : null,
      text: item.text as string,
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
      caption: typeof item.caption === "string" ? item.caption : null,
    }));
}
