import EyeOffIcon from "@/components/icons/EyeOffIcon";
import { toggleHidden } from "@/lib/recipes/hiddenActions";

/** A plain server-rendered form + button, same shape as FavouriteToggleButton — toggles isHidden rather than isFavourite. Only shown for auto-imported (HelloFresh-scraped) recipes; a custom/PDF recipe gets a real delete instead (see DeleteRecipeButton on the edit page). */
export default function HideToggleButton({
  recipeId,
  isHidden,
  compact = false,
}: {
  recipeId: string;
  isHidden: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <form action={toggleHidden.bind(null, recipeId)}>
        <button
          type="submit"
          aria-label={isHidden ? "Unhide this recipe" : "Hide this recipe"}
          title={isHidden ? "Unhide this recipe" : "Hide this recipe"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border shadow-sm backdrop-blur ${
            isHidden
              ? "border-zinc-700 bg-zinc-900 text-white"
              : "border-white/70 bg-white/80 text-zinc-500 hover:text-zinc-900"
          }`}
        >
          <EyeOffIcon className="h-4 w-4" />
        </button>
      </form>
    );
  }

  return (
    <form action={toggleHidden.bind(null, recipeId)}>
      <button
        type="submit"
        className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium ${
          isHidden
            ? "border-zinc-700 bg-zinc-900 text-white"
            : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
        }`}
      >
        <EyeOffIcon className="h-4 w-4" />
        {isHidden ? "Unhide" : "Hide"}
      </button>
    </form>
  );
}
