import Link from "next/link";
import BackLink from "@/components/BackLink";
import { addRecipesToPlan } from "@/lib/mealplan/actions";
import { suggestMealCombinations } from "@/lib/mealplan/autoSuggest";
import { computeSharedIngredients } from "@/lib/recipes/sharedIngredients";
import { listRecipeIngredientSetsForSuggestion, markRecipesSuggested } from "@/lib/recipes/queries";
import {
  buildFilterQueryString,
  parseFilters,
  toListParams,
  type RawSearchParams,
} from "@/lib/recipes/searchParamsUtil";
import { requireMemberOrRedirect } from "@/lib/require-member";

const MEAL_COUNT_OPTIONS = [2, 3, 4, 5];
const CANDIDATE_POOL_CAP = 400;

export default async function SuggestPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { householdId } = await requireMemberOrRedirect();
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const rawCount = Number.parseInt(Array.isArray(raw.n) ? raw.n[0] : (raw.n ?? "3"), 10);
  const count = MEAL_COUNT_OPTIONS.includes(rawCount) ? rawCount : 3;

  const listParams = toListParams(filters, CANDIDATE_POOL_CAP);
  let pool = await listRecipeIngredientSetsForSuggestion(listParams, householdId, CANDIDATE_POOL_CAP);
  // A heavily-filtered pool can be small enough that excluding recently-
  // suggested recipes (the default — see listRecipeIngredientSetsForSuggestion)
  // leaves too few to suggest from at all; falling back to the unfiltered
  // pool beats showing nothing. Recently-suggested recipes still get
  // deprioritized naturally by pickSeeds' quality-based seeding either way.
  if (pool.length < count) {
    pool = await listRecipeIngredientSetsForSuggestion(listParams, householdId, CANDIDATE_POOL_CAP, {
      excludeRecentlySuggested: false,
    });
  }

  const combinations = suggestMealCombinations(
    pool.map((r) => ({
      id: r.id,
      ingredientIds: r.ingredientIds,
      qualityScore: r.ratingValue ?? 0,
    })),
    count,
  );

  const recipeById = new Map(pool.map((r) => [r.id, r]));
  const combosWithDetail = await Promise.all(
    combinations.map(async (combo) => ({
      ...combo,
      recipes: combo.recipeIds.map((id) => recipeById.get(id)!),
      shared: (await computeSharedIngredients(combo.recipeIds)).ingredientGroups.filter(
        (g) => g.isShared,
      ),
    })),
  );

  // Every recipe actually *shown* counts as "suggested," not just whichever
  // option the user goes on to pick — see markRecipesSuggested.
  await markRecipesSuggested(combinations.flatMap((c) => c.recipeIds), householdId);

  const filterQueryString = buildFilterQueryString(filters);
  const mealCountHref = (n: number) => {
    const params = new URLSearchParams(filterQueryString.replace(/^\?/, ""));
    params.set("n", String(n));
    return `/suggest?${params.toString()}`;
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Suggest a week</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Picks recipe combinations from your current browse filters that share the most
        ingredients — buy less, waste less.{" "}
        {filterQueryString && (
          <Link href={`/${filterQueryString}`} className="text-emerald-700 hover:underline">
            Adjust filters
          </Link>
        )}
      </p>

      <div className="mt-4 flex gap-2">
        {MEAL_COUNT_OPTIONS.map((option) => (
          <Link
            key={option}
            href={mealCountHref(option)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
              option === count
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
            }`}
          >
            {option} meals
          </Link>
        ))}
      </div>

      {pool.length < count ? (
        <p className="mt-8 text-sm text-zinc-500">
          Not enough recipes match your current filters to suggest {count} meals ({pool.length}{" "}
          available). Try broadening your filters.
        </p>
      ) : combosWithDetail.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">No suggestions found — try different filters.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {combosWithDetail.map((combo, i) => (
            <div key={i} className="rounded-2xl border border-zinc-200 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Option {i + 1} — {combo.shared.length} shared ingredient
                  {combo.shared.length === 1 ? "" : "s"}
                </h2>
                <form action={addRecipesToPlan.bind(null, combo.recipeIds)}>
                  <button
                    type="submit"
                    className="rounded-full border border-emerald-600 bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Use this week
                  </button>
                </form>
              </div>

              <ul className="mt-3 space-y-1 text-sm text-zinc-700">
                {combo.recipes.map((recipe) => (
                  <li key={recipe.id}>
                    <Link href={`/recipes/${recipe.slug}`} className="hover:underline">
                      {recipe.name}
                    </Link>
                  </li>
                ))}
              </ul>

              {combo.shared.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {combo.shared.map((group) => (
                    <span
                      key={group.ingredientId}
                      className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium capitalize text-emerald-900"
                    >
                      {group.canonicalName} × {group.recipeCount}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
