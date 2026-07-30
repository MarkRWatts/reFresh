import { prisma } from "@/lib/db";

export interface ShoppingListEntry {
  recipeId: string;
  recipeName: string;
  quantity: number | null;
  unit: string | null;
  rawText: string;
}

export interface QuantityByUnit {
  unit: string | null;
  totalQuantity: number;
}

export interface IngredientGroup {
  ingredientId: string;
  canonicalName: string;
  recipeCount: number;
  isShared: boolean; // used in 2+ of the given recipes
  entries: ShoppingListEntry[];
  /**
   * Quantities summed within matching units only — no unit conversion
   * (e.g. tbsp -> ml) is done, so an ingredient specified in two different
   * units across recipes shows as two separate totals rather than one
   * combined figure. Entries with no parsed quantity are simply omitted
   * from every bucket, not silently counted as zero.
   */
  quantitiesByUnit: QuantityByUnit[];
}

function summarizeQuantities(entries: ShoppingListEntry[]): QuantityByUnit[] {
  const totals = new Map<string | null, number>();
  for (const entry of entries) {
    if (entry.quantity == null) continue;
    totals.set(entry.unit, (totals.get(entry.unit) ?? 0) + entry.quantity);
  }
  return [...totals.entries()]
    .map(([unit, totalQuantity]) => ({ unit, totalQuantity }))
    .sort((a, b) => (a.unit ?? "").localeCompare(b.unit ?? ""));
}

export interface SharedIngredientsResult {
  recipes: { id: string; name: string }[];
  ingredientGroups: IngredientGroup[];
}

/**
 * Groups every ingredient across a set of recipes by canonical ingredient,
 * so the planner can highlight what's shared (waste-reduction signal) and
 * render a consolidated shopping list. Quantities are summed within
 * matching units (summarizeQuantities); true cross-unit conversion
 * (e.g. tbsp -> ml) is still out of scope.
 *
 * `servingsOverrides` lets a caller (the planner) scale a recipe's
 * ingredient quantities to a serving count other than the recipe's own
 * base — e.g. cooking a 2-serving recipe for 4 people doubles every
 * quantity before it's summed into the shared total. A recipe not present
 * in the map (or a recipe with no known base `servings` to scale from)
 * contributes its raw scraped quantities unchanged.
 */
export async function computeSharedIngredients(
  recipeIds: string[],
  servingsOverrides: Map<string, number> = new Map(),
): Promise<SharedIngredientsResult> {
  if (recipeIds.length === 0) {
    return { recipes: [], ingredientGroups: [] };
  }

  const recipes = await prisma.recipe.findMany({
    where: { id: { in: recipeIds } },
    select: { id: true, name: true, servings: true },
  });

  const recipeIngredients = await prisma.recipeIngredient.findMany({
    where: { recipeId: { in: recipeIds } },
    include: { ingredient: true },
  });

  const recipeById = new Map(recipes.map((r) => [r.id, r]));
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
        quantitiesByUnit: [],
      };
      groupsByIngredientId.set(ri.ingredientId, group);
    }

    const baseServings = recipeById.get(ri.recipeId)?.servings;
    const targetServings = servingsOverrides.get(ri.recipeId);
    const multiplier = baseServings && targetServings ? targetServings / baseServings : 1;

    group.entries.push({
      recipeId: ri.recipeId,
      recipeName: recipeById.get(ri.recipeId)?.name ?? "Unknown recipe",
      quantity: ri.quantity != null ? ri.quantity * multiplier : null,
      unit: ri.unit,
      rawText: ri.rawText,
    });
  }

  for (const group of groupsByIngredientId.values()) {
    const distinctRecipes = new Set(group.entries.map((e) => e.recipeId));
    group.recipeCount = distinctRecipes.size;
    group.isShared = group.recipeCount >= 2;
    group.quantitiesByUnit = summarizeQuantities(group.entries);
  }

  const ingredientGroups = [...groupsByIngredientId.values()].sort((a, b) => {
    if (a.isShared !== b.isShared) return a.isShared ? -1 : 1;
    if (a.recipeCount !== b.recipeCount) return b.recipeCount - a.recipeCount;
    return a.canonicalName.localeCompare(b.canonicalName);
  });

  return { recipes, ingredientGroups };
}
