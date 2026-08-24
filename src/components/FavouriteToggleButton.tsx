import { Heart } from "lucide-react";
import { toggleFavourite } from "@/lib/favourites/actions";

/** A plain server-rendered form + button — no client JS needed for a simple toggle. */
export default function FavouriteToggleButton({
  recipeId,
  isFavourite,
  compact = false,
}: {
  recipeId: string;
  isFavourite: boolean;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <form action={toggleFavourite.bind(null, recipeId)}>
        <button
          type="submit"
          aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border shadow-sm backdrop-blur ${
            isFavourite
              ? "border-pink-500 bg-white text-pink-500"
              : "border-white/70 bg-white/80 text-zinc-500 hover:text-pink-500"
          }`}
        >
          <Heart className="h-4 w-4" fill={isFavourite ? "currentColor" : "none"} />
        </button>
      </form>
    );
  }

  return (
    <form action={toggleFavourite.bind(null, recipeId)}>
      <button
        type="submit"
        aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
        className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium ${
          isFavourite
            ? "border-pink-500 bg-pink-50 text-pink-600 hover:bg-pink-100"
            : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
        }`}
      >
        <Heart className="h-4 w-4" fill={isFavourite ? "currentColor" : "none"} />
        {isFavourite ? "Favourited" : "Add to favourites"}
      </button>
    </form>
  );
}
