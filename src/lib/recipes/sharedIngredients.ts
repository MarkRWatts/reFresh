import { prisma } from "@/lib/db";

export interface ShoppingListEntry {
  recipeId: string;
  recipeName: string;
  quantity: number | null;
  unit: string | null;
  rawText: string;
}

export interface IngredientGroup {
  ingredientId: string;
  canonicalName: string;
  recipeCount: number;
  isShared: boolean; // used in 2+ of the given recipes
  entries: ShoppingListEntry[];
}

export interface SharedIngredientsResult {
  recipes: { id: string; name: string }[];
  ingredientGroups: IngredientGroup[];
}

/**
 * Groups every ingredient across a set of recipes by canonical ingredient,
 * so the planner can highlight what's shared (waste-reduction signal) and
 * render a consolidated shopping list. Quantities are NOT summed across
 * differing units here — that's deferred to the Phase 5 shopping-list UI,
 * which needs real unit conversion (see project plan).
 */
export async function computeSharedIngredients(
  recipeIds: string[],
): Promise<SharedIngredientsResult> {
  if (recipeIds.length === 0) {
    return { recipes: [], ingredientGroups: [] };
  }

  const recipes = await prisma.recipe.findMany({
    where: { id: { in: recipeIds } },
    select: { id: true, name: true },
  });

  const recipeIngredients = await prisma.recipeIngredient.findMany({
    where: { recipeId: { in: recipeIds } },
    include: { ingredient: true },
  });

  const recipeNameById = new Map(recipes.map((r) => [r.id, r.name]));
  const groupsByIngredientId = new Map<string, IngredientGroup>();

  for (const ri of recipeIngredients) {
    let group = groupsByIngredientId.get(ri.ingredientId);
    if (!group) {
      group = {
        ingredientId: ri.ingredientId,
        canonicalName: ri.ingredient.canonicalName,
        recipeCount: 0,
        isShared: false,
        entries: [],
      };
      groupsByIngredientId.set(ri.ingredientId, group);
    }
    group.entries.push({
      recipeId: ri.recipeId,
      recipeName: recipeNameById.get(ri.recipeId) ?? "Unknown recipe",
      quantity: ri.quantity,
      unit: ri.unit,
      rawText: ri.rawText,
    });
  }

  for (const group of groupsByIngredientId.values()) {
    const distinctRecipes = new Set(group.entries.map((e) => e.recipeId));
    group.recipeCount = distinctRecipes.size;
    group.isShared = group.recipeCount >= 2;
  }

  const ingredientGroups = [...groupsByIngredientId.values()].sort((a, b) => {
    if (a.isShared !== b.isShared) return a.isShared ? -1 : 1;
    if (a.recipeCount !== b.recipeCount) return b.recipeCount - a.recipeCount;
    return a.canonicalName.localeCompare(b.canonicalName);
  });

  return { recipes, ingredientGroups };
}
