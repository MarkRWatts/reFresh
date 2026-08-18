import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import BackLink from "@/components/BackLink";
import SubmitButton from "@/components/SubmitButton";
import DeleteRecipeButton from "@/components/DeleteRecipeButton";
import { TextField, NutritionFieldsSection, StepsFieldsSection } from "@/components/RecipeEditorFields";
import { getRecipeBySlug } from "@/lib/recipes/queries";
import { updateRecipeFields } from "@/lib/recipes/recipeEditActions";
import { parseRecipeSteps } from "@/lib/recipes/steps";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) notFound();
  if (!recipe.isUserCreated) redirect(`/recipes/${slug}`);

  const recipeSteps = parseRecipeSteps(recipe.steps);
  const steps = recipeSteps.map((s) => ({ heading: null, text: s.text }));
  const stepImageUrls = recipeSteps.map((s) => s.imageUrl);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Editing {recipe.name}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Change anything below, then save. Ingredient rows: clear a name to drop it, or fill in the
        blank row at the bottom to add one. Steps: clear a step&rsquo;s instructions to drop it.
      </p>

      <form action={updateRecipeFields.bind(null, recipe.id)} className="mt-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" name="name" defaultValue={recipe.name} />
          <TextField label="Subtitle" name="subtitle" defaultValue={recipe.subtitle ?? ""} />
          <TextField label="Cook minutes" name="cookMinutes" type="number" defaultValue={recipe.cookMinutes ?? ""} />
        </div>

        <div className="rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Ingredients ({recipe.ingredients.length})</h2>
          <div className="mt-3 space-y-2">
            {[...recipe.ingredients, null].map((ri, i) => (
              <div
                key={ri?.id ?? "new"}
                className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-2 first:border-t-0 first:pt-0"
              >
                <div className="w-20">
                  <TextField label="Qty" name="ingredientQuantity" defaultValue={ri?.quantity ?? ""} />
                </div>
                <div className="w-24">
                  <TextField label="Unit" name="ingredientUnit" defaultValue={ri?.unit ?? ""} />
                </div>
                <div className="min-w-0 flex-1">
                  <TextField
                    label={i === recipe.ingredients.length ? "New ingredient" : "Name"}
                    name="ingredientName"
                    defaultValue={ri?.ingredient.canonicalName ?? ""}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <NutritionFieldsSection nutrition={recipe} />

        <StepsFieldsSection steps={steps} stepImageUrls={stepImageUrls} showHeading={false} />

        <div className="flex items-center gap-3">
          <SubmitButton
            label="Save changes"
            pendingLabel="Saving…"
            className="inline-flex items-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-300 disabled:bg-emerald-300"
          />
          <Link
            href={`/recipes/${slug}`}
            className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400"
          >
            Cancel
          </Link>
        </div>
      </form>

      <div className="mt-6 border-t border-zinc-200 pt-4">
        <DeleteRecipeButton recipeId={recipe.id} recipeName={recipe.name} />
      </div>
    </main>
  );
}
