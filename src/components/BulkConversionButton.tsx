"use client";

import { useState } from "react";

/**
 * One-click bulk action for the ingredient conversion review page (see
 * rebaseIngredientToPackagedBase / convertPackagedUnitMentionsToBase in
 * actions.ts) — gated behind a confirm() dialog since it writes every
 * eligible recipe in one go, unlike the per-row Apply buttons in the
 * table below it.
 */
export default function BulkConversionButton({
  label,
  confirmMessage,
  eligibleCount,
  resultLabel,
  action,
}: {
  label: string;
  confirmMessage: string;
  eligibleCount: number;
  /** e.g. "Relabeled" or "Converted" — combined with the actual count returned by `action` for the result message. */
  resultLabel: string;
  action: () => Promise<number>;
}) {
  const [result, setResult] = useState<number | null>(null);

  if (eligibleCount === 0 || result != null) {
    return result != null ? (
      <p className="mt-3 text-sm text-emerald-700">
        {resultLabel} {result} recipe{result === 1 ? "" : "s"}.
      </p>
    ) : null;
  }

  async function handleClick() {
    if (!confirm(confirmMessage)) return;
    setResult(await action());
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-3 rounded-full border border-amber-600 bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
    >
      {label}
    </button>
  );
}
