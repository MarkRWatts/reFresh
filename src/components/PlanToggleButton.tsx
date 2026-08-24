import { Check, Plus } from "lucide-react";
import { addRecipeToPlan, removeRecipeFromPlan } from "@/lib/mealplan/actions";

/** A plain server-rendered form + button — no client JS needed for a simple add/remove toggle. */
export default function PlanToggleButton({
  recipeId,
  inPlan,
  compact = false,
}: {
  recipeId: string;
  inPlan: boolean;
  compact?: boolean;
}) {
  const action = inPlan ? removeRecipeFromPlan : addRecipeToPlan;

  if (compact) {
    return (
      <form action={action.bind(null, recipeId)}>
        <button
          type="submit"
          aria-label={inPlan ? "Remove from this week" : "Add to this week"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm ${
            inPlan
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400"
          }`}
        >
          {inPlan ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </form>
    );
  }

  return (
    <form action={action.bind(null, recipeId)}>
      <button
        type="submit"
        className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium ${
          inPlan
            ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
            : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
        }`}
      >
        {inPlan ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {inPlan ? "Added to this week" : "Add to this week"}
      </button>
    </form>
  );
}
