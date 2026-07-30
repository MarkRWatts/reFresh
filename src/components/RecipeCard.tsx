import Image from "next/image";
import Link from "next/link";
import RecipeImagePlaceholder from "@/components/RecipeImagePlaceholder";
import PlanToggleButton from "@/components/PlanToggleButton";
import FavouriteToggleButton from "@/components/FavouriteToggleButton";
import { PROTEIN_BADGE_STYLES, PROTEIN_LABELS } from "@/lib/recipes/filterPresets";
import { hasUsableImage } from "@/lib/recipes/imageUrl";
import type { RecipeSummary } from "@/lib/recipes/queries";

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export default function RecipeCard({
  recipe,
  inPlan,
}: {
  recipe: RecipeSummary;
  inPlan: boolean;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] w-full bg-zinc-100">
        <Link href={`/recipes/${recipe.slug}`} className="absolute inset-0">
          {hasUsableImage(recipe.imageUrl) ? (
            <Image
              src={recipe.imageUrl}
              alt={recipe.name}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
              className="object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <RecipeImagePlaceholder />
          )}
        </Link>
        <div className="absolute right-2 top-2">
          <FavouriteToggleButton recipeId={recipe.id} isFavourite={recipe.isFavourite} compact />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/recipes/${recipe.slug}`} className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold text-zinc-900">{recipe.name}</h3>
            {recipe.subtitle && (
              <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{recipe.subtitle}</p>
            )}
          </Link>
          <PlanToggleButton recipeId={recipe.id} inPlan={inPlan} compact />
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
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
          {recipe.ratingValue != null && (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              ★ {recipe.ratingValue.toFixed(1)}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
