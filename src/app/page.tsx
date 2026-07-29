import FilterBar from "@/components/FilterBar";
import Pagination from "@/components/Pagination";
import RecipeCard from "@/components/RecipeCard";
import { getCurrentPlanRecipeIds } from "@/lib/mealplan/queries";
import { listCuisines, listRecipes } from "@/lib/recipes/queries";
import { parseFilters, toListParams, type RawSearchParams } from "@/lib/recipes/searchParamsUtil";

const PAGE_SIZE = 24;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parseFilters(await searchParams);

  const [{ recipes, total }, cuisines, planRecipeIds] = await Promise.all([
    listRecipes(toListParams(filters, PAGE_SIZE)),
    listCuisines(),
    getCurrentPlanRecipeIds(),
  ]);

  return (
    <>
      <FilterBar filters={filters} cuisines={cuisines} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <p className="mb-4 text-sm text-zinc-500">
          {total.toLocaleString()} recipe{total === 1 ? "" : "s"}
        </p>

        {recipes.length === 0 ? (
          <p className="py-16 text-center text-zinc-500">
            No recipes match those filters. Try broadening your search.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {recipes.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} inPlan={planRecipeIds.has(recipe.id)} />
            ))}
          </div>
        )}

        <Pagination filters={filters} total={total} pageSize={PAGE_SIZE} />
      </main>
    </>
  );
}
