"use client";

import { deleteRecipe } from "@/lib/recipes/recipeEditActions";

/** A plain server-action form, same as FavouriteToggleButton/PlanToggleButton, but guarded by a confirm() dialog first — the only destructive, irreversible action in the app (see recipeEditActions.ts's deleteRecipe), which warrants a check the rest of those simple toggles don't need. */
export default function DeleteRecipeButton({ recipeId, recipeName }: { recipeId: string; recipeName: string }) {
  return (
    <form
      action={deleteRecipe.bind(null, recipeId)}
      onSubmit={(e) => {
        if (!confirm(`Delete "${recipeName}"? This can't be undone.`)) e.preventDefault();
      }}
    >
      <button
        type="submit"
        className="rounded-full border border-red-200 bg-white px-4 py-1.5 text-sm font-medium text-red-600 hover:border-red-400 hover:bg-red-50"
      >
        Delete recipe
      </button>
    </form>
  );
}
