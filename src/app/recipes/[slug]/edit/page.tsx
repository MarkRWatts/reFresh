import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getRecipeBySlug } from "@/lib/recipes/queries";
import { addCustomIngredient, removeCustomIngredient } from "@/lib/recipes/customRecipeActions";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) notFound();
  if (!recipe.isUserCreated) redirect(`/recipes/${slug}`);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <Link href={`/recipes/${slug}`} className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Back to {recipe.name}
      </Link>

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Editing ingredients</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Add or remove ingredients below. Everything else (steps, photo, nutrition) stays as
        cloned from the original recipe.
      </p>

      <div className="mt-6 rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Ingredients</h2>
        <ul className="mt-2 space-y-1.5">
          {recipe.ingredients.map((ri) => (
            <li
              key={ri.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700"
            >
              <span>
                {ri.quantity != null && <span className="text-zinc-400">{ri.quantity} </span>}
                {ri.unit && <span className="text-zinc-400">{ri.unit} </span>}
                {ri.ingredient.canonicalName}
              </span>
              <form action={removeCustomIngredient.bind(null, ri.id)}>
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

        <form
          action={addCustomIngredient.bind(null, recipe.id)}
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4"
        >
          <div className="flex flex-col">
            <label className="text-xs text-zinc-500" htmlFor="quantity">
              Quantity
            </label>
            <input
              id="quantity"
              name="quantity"
              type="text"
              inputMode="decimal"
              placeholder="1"
              className="w-20 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-zinc-500" htmlFor="unit">
              Unit
            </label>
            <input
              id="unit"
              name="unit"
              type="text"
              placeholder="grams"
              className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <label className="text-xs text-zinc-500" htmlFor="name">
              Ingredient
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="Garlic Clove"
              className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-full border border-emerald-600 bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Add
          </button>
        </form>
      </div>

      <Link
        href={`/recipes/${slug}`}
        className="mt-6 inline-block rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400"
      >
        Done editing
      </Link>
    </main>
  );
}
