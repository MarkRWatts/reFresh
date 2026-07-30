import Link from "next/link";
import PrintButton from "@/components/PrintButton";
import { getCurrentPlanRecipes } from "@/lib/mealplan/queries";
import { computeSharedIngredients } from "@/lib/recipes/sharedIngredients";

function formatQuantity(unit: string | null, totalQuantity: number): string {
  const rounded = Math.round(totalQuantity * 100) / 100;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

export default async function PlanPrintPage() {
  const recipes = await getCurrentPlanRecipes();
  const servingsOverrides = new Map(
    recipes.filter((r) => r.planServings != null).map((r) => [r.id, r.planServings!]),
  );
  const { ingredientGroups } =
    recipes.length > 0
      ? await computeSharedIngredients(recipes.map((r) => r.id), servingsOverrides)
      : { ingredientGroups: [] };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6 print:px-0 print:py-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
          ← Back to recipes
        </Link>
        <PrintButton label="Print shopping list" />
      </div>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900 print:mt-0">Shopping list</h1>
      <p className="mt-1 text-sm text-zinc-500 print:hidden">
        {recipes.length} recipe{recipes.length === 1 ? "" : "s"} this week
      </p>

      {recipes.length === 0 ? (
        <p className="mt-8 text-zinc-500">Your week is empty — nothing to print yet.</p>
      ) : (
        <>
          <div className="mt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Recipes
            </h2>
            <ul className="mt-2 text-sm text-zinc-700">
              {recipes.map((recipe) => {
                const effectiveServings = recipe.planServings ?? recipe.baseServings;
                return (
                  <li key={recipe.id}>
                    {recipe.name}
                    {effectiveServings != null && effectiveServings !== recipe.baseServings && (
                      <span className="text-zinc-400"> ({effectiveServings}p)</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <ul className="mt-6">
            {ingredientGroups.map((group) => (
              <li
                key={group.ingredientId}
                className="flex items-center justify-between gap-3 border-b border-zinc-200 py-3 text-base print:py-2"
              >
                <span className="flex items-center gap-3">
                  <span
                    className="h-5 w-5 shrink-0 rounded border-2 border-zinc-400 print:border-black"
                    aria-hidden
                  />
                  <span className="capitalize text-zinc-900">{group.canonicalName}</span>
                </span>
                <span className="shrink-0 text-zinc-500">
                  {group.quantitiesByUnit.length > 0
                    ? group.quantitiesByUnit
                        .map((q) => formatQuantity(q.unit, q.totalQuantity))
                        .join(" + ")
                    : `x${group.entries.length}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
