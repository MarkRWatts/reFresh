"use client";

import { useState } from "react";
import { rebaseIngredientToPackagedBase } from "@/lib/ingredients/actions";

/**
 * Bulk-relabels every recipe currently in the "other" unit (e.g. grams,
 * when the packaged size is in ml) to match — see
 * rebaseIngredientToPackagedBase. A confirm() dialog first since this
 * touches every eligible recipe in one go, unlike the per-row Apply
 * buttons in the table below.
 */
export default function RebaseToMlButton({
  ingredientId,
  eligibleCount,
  otherUnit,
  targetUnit,
}: {
  ingredientId: string;
  eligibleCount: number;
  otherUnit: string;
  targetUnit: string;
}) {
  const [result, setResult] = useState<number | null>(null);

  if (eligibleCount === 0 || result != null) {
    return result != null ? (
      <p className="mt-3 text-sm text-emerald-700">
        Relabeled {result} recipe{result === 1 ? "" : "s"} from {otherUnit} to {targetUnit}.
      </p>
    ) : null;
  }

  async function handleClick() {
    const confirmed = confirm(
      `Relabel ${eligibleCount} recipe${eligibleCount === 1 ? "" : "s"} currently in ${otherUnit} to ${targetUnit}?\n\n` +
        `The number itself won't change (e.g. "150${otherUnit}" -> "150${targetUnit}") — this assumes ~1${otherUnit} ≈ 1${targetUnit}, ` +
        `a reasonable approximation for a dairy/liquid-ish product but not an exact conversion.`,
    );
    if (!confirmed) return;
    const count = await rebaseIngredientToPackagedBase(ingredientId);
    setResult(count);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-3 rounded-full border border-amber-600 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
    >
      Relabel {eligibleCount} recipe{eligibleCount === 1 ? "" : "s"} from {otherUnit} to {targetUnit}
    </button>
  );
}
