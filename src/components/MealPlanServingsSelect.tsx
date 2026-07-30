"use client";

import { setMealPlanRecipeServings } from "@/lib/mealplan/actions";

const SERVING_OPTIONS = [2, 3, 4];

export default function MealPlanServingsSelect({
  recipeId,
  servings,
}: {
  recipeId: string;
  servings: number;
}) {
  return (
    <form action={setMealPlanRecipeServings.bind(null, recipeId)}>
      <select
        key={servings}
        name="servings"
        defaultValue={servings}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-600"
        aria-label="Servings"
      >
        {SERVING_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}p
          </option>
        ))}
      </select>
    </form>
  );
}
