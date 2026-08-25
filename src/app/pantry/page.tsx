import BackLink from "@/components/BackLink";
import FilterBar from "@/components/FilterBar";
import IngredientPicker from "@/components/IngredientPicker";
import RecipeCard from "@/components/RecipeCard";
import { getCurrentPlanRecipeIds } from "@/lib/mealplan/queries";
import { getIngredientsByIds, listCuisines, matchRecipesByIngredients } from "@/lib/recipes/queries";
import { parseFilters, toListParams, type RawSearchParams } from "@/lib/recipes/searchParamsUtil";
import { requireMemberOrRedirect } from "@/lib/require-member";

export default async function PantryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { householdId } = await requireMemberOrRedirect();
  const filters = parseFilters(await searchParams);

  const [selectedIngredients, cuisines, planRecipeIds] = await Promise.all([
    getIngredientsByIds(filters.ingredientIds),
    listCuisines(),
    getCurrentPlanRecipeIds(householdId),
  ]);

  const { matches, poolSize } =
    filters.ingredientIds.length > 0
      ? await matchRecipesByIngredients(filters.ingredientIds, toListParams(filters, 60), householdId)
      : { matches: [], poolSize: 0 };

  return (
    <>
      <FilterBar filters={filters} cuisines={cuisines} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">What can I make?</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Add what&apos;s in your kitchen and we&apos;ll rank recipes by how much of it they use.
        </p>

        <div className="mt-4">
          <IngredientPicker selected={selectedIngredients} />
        </div>

        {filters.ingredientIds.length === 0 ? (
          <p className="mt-10 text-sm text-zinc-500">
            Add a few ingredients above to see matching recipes.
          </p>
        ) : matches.length === 0 ? (
          <p className="mt-10 text-sm text-zinc-500">
            No recipes use any of those ingredients yet — try adding more, or a different one.
          </p>
        ) : (
          <>
            <p className="mt-6 text-sm text-zinc-500">
              {matches.length} recipe{matches.length === 1 ? "" : "s"} use at least one of your
              ingredients{poolSize > matches.length ? ` (showing the top ${matches.length})` : ""}.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {matches.map(({ recipe, matchCount, totalCount, missingIngredientNames }) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  inPlan={planRecipeIds.has(recipe.id)}
                  match={{ matchCount, totalCount, missingIngredientNames }}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
