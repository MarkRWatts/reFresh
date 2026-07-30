import Link from "next/link";
import { getCurrentPlanRecipes } from "@/lib/mealplan/queries";
import { removeRecipeFromPlan } from "@/lib/mealplan/actions";
import { computeSharedIngredients } from "@/lib/recipes/sharedIngredients";
import MealPlanServingsSelect from "@/components/MealPlanServingsSelect";

function formatQuantity(unit: string | null, totalQuantity: number): string {
  const rounded = Math.round(totalQuantity * 100) / 100;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

export default async function PlanDrawerContent() {
  const recipes = await getCurrentPlanRecipes();

  if (recipes.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Your week is empty. Add recipes from the browse grid to start building a shopping
        list — ingredients shared across 2+ recipes will be highlighted here.
      </p>
    );
  }

  const servingsOverrides = new Map(
    recipes.filter((r) => r.planServings != null).map((r) => [r.id, r.planServings!]),
  );
  const { ingredientGroups } = await computeSharedIngredients(
    recipes.map((r) => r.id),
    servingsOverrides,
  );
  const sharedGroups = ingredientGroups.filter((g) => g.isShared);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Recipes ({recipes.length})
        </h3>
        <ul className="mt-2 space-y-2">
          {recipes.map((recipe) => (
            <li
              key={recipe.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2"
            >
              <Link
                href={`/recipes/${recipe.slug}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 hover:underline"
              >
                {recipe.name}
              </Link>
              {recipe.baseServings != null && (
                <MealPlanServingsSelect
                  recipeId={recipe.id}
                  servings={recipe.planServings ?? recipe.baseServings}
                />
              )}
              <form action={removeRecipeFromPlan.bind(null, recipe.id)}>
                <button
                  type="submit"
                  className="shrink-0 text-xs font-medium text-zinc-400 hover:text-red-600"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>

      {sharedGroups.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Shared ingredients — buy once, use twice
          </h3>
          <ul className="mt-2 space-y-2">
            {sharedGroups.map((group) => (
              <li
                key={group.ingredientId}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium capitalize text-emerald-900">
                    {group.canonicalName}
                  </span>
                  <span className="text-xs text-emerald-700">{group.recipeCount} recipes</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Shopping list
          </h3>
          <Link
            href="/plan/print"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            🖨️ Print
          </Link>
        </div>
        <ul className="mt-2 space-y-1.5">
          {ingredientGroups.map((group) => (
            <li
              key={group.ingredientId}
              className="flex items-center justify-between gap-2 text-sm text-zinc-700"
            >
              <span className="capitalize">{group.canonicalName}</span>
              <span className="shrink-0 text-zinc-400">
                {group.quantitiesByUnit.length > 0
                  ? group.quantitiesByUnit
                      .map((q) => formatQuantity(q.unit, q.totalQuantity))
                      .join(" + ")
                  : `x${group.entries.length}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
