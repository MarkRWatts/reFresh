import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import PlanToggleButton from "@/components/PlanToggleButton";
import FavouriteToggleButton from "@/components/FavouriteToggleButton";
import RecipeImagePlaceholder from "@/components/RecipeImagePlaceholder";
import { getCurrentPlanRecipeIds } from "@/lib/mealplan/queries";
import { PROTEIN_BADGE_STYLES, PROTEIN_LABELS } from "@/lib/recipes/filterPresets";
import { hasUsableImage } from "@/lib/recipes/imageUrl";
import { getRecipeBySlug } from "@/lib/recipes/queries";
import { parseRecipeSteps } from "@/lib/recipes/steps";

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${className}`}>
      {children}
    </span>
  );
}

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) notFound();
  const steps = parseRecipeSteps(recipe.steps);
  const planRecipeIds = await getCurrentPlanRecipeIds();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Back to recipes
      </Link>

      <div className="mt-4 grid gap-6 sm:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 sm:order-1">
          <h1 className="text-2xl font-semibold text-zinc-900">{recipe.name}</h1>
          {recipe.subtitle && <p className="mt-1 text-zinc-500">{recipe.subtitle}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className={PROTEIN_BADGE_STYLES[recipe.proteinType]}>
              {PROTEIN_LABELS[recipe.proteinType]}
            </Badge>
            {recipe.calories != null && (
              <Badge className="border-zinc-200 bg-zinc-50 text-zinc-600">
                {recipe.calories} kcal
              </Badge>
            )}
            {recipe.cookMinutes != null && (
              <Badge className="border-zinc-200 bg-zinc-50 text-zinc-600">
                {recipe.cookMinutes} min
              </Badge>
            )}
            {recipe.servings != null && (
              <Badge className="border-zinc-200 bg-zinc-50 text-zinc-600">
                Serves {recipe.servings}
              </Badge>
            )}
            {recipe.cuisine && (
              <Badge className="border-zinc-200 bg-zinc-50 text-zinc-600">{recipe.cuisine}</Badge>
            )}
            {recipe.ratingValue != null && (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                ★ {recipe.ratingValue.toFixed(1)}
                {recipe.ratingCount != null && ` (${recipe.ratingCount})`}
              </Badge>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <PlanToggleButton recipeId={recipe.id} inPlan={planRecipeIds.has(recipe.id)} />
            <FavouriteToggleButton recipeId={recipe.id} isFavourite={recipe.isFavourite} />
          </div>

          {recipe.description && <p className="mt-4 text-zinc-600">{recipe.description}</p>}

          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            View original recipe on HelloFresh ↗
          </a>

          {steps.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-zinc-900">Instructions</h2>
              <ol className="mt-3 space-y-4">
                {steps.map((step, i) => (
                  <li key={i} className="flex gap-3 rounded-2xl border border-zinc-200 p-4">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-line text-sm text-zinc-700">{step.text}</p>
                      {step.imageUrl && (
                        <div className="relative mt-3 aspect-[4/3] w-full max-w-xs overflow-hidden rounded-xl bg-zinc-100">
                          <Image
                            src={step.imageUrl}
                            alt={step.caption ?? `Step ${i + 1}`}
                            fill
                            sizes="20rem"
                            className="object-cover"
                          />
                          {step.caption && (
                            <span className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1 text-xs font-medium text-white">
                              {step.caption}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="order-1 sm:order-2">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-zinc-100">
            {hasUsableImage(recipe.imageUrl) ? (
              <Image
                src={recipe.imageUrl}
                alt={recipe.name}
                fill
                sizes="(min-width: 640px) 20rem, 100vw"
                className="object-cover"
                priority
              />
            ) : (
              <RecipeImagePlaceholder />
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200 p-4">
            <h2 className="text-sm font-semibold text-zinc-900">Ingredients</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-zinc-600">
              {recipe.ingredients.map((ri) => (
                <li key={ri.id}>
                  {ri.quantity != null && <span className="text-zinc-400">{ri.quantity} </span>}
                  {ri.unit && <span className="text-zinc-400">{ri.unit} </span>}
                  {ri.ingredient.canonicalName}
                </li>
              ))}
            </ul>
          </div>

          {recipe.variants.length > 0 && (
            <div className="mt-4 rounded-2xl border border-zinc-200 p-4">
              <h2 className="text-sm font-semibold text-zinc-900">Similar variants</h2>
              <p className="mt-1 text-xs text-zinc-500">
                HelloFresh reuses this dish with a different side across other weeks.
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {recipe.variants.map((variant) => (
                  <li key={variant.id}>
                    <Link
                      href={`/recipes/${variant.slug}`}
                      className="text-emerald-700 hover:text-emerald-800 hover:underline"
                    >
                      {variant.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
