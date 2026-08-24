"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { applyPackagedUnitConversion } from "@/lib/ingredients/actions";
import type { ConversionCandidateRow } from "@/lib/ingredients/conversionQueries";

interface IngredientInfo {
  id: string;
  packagedUnit: string | null;
}

const MATCH_TYPE_LABEL: Record<string, string> = {
  "already-base": "Already in the base unit",
  "other-unit": "Different unit — not handled here",
  "no-quantity": "No quantity recorded",
  "no-packaging": "No packaging defined yet",
};

function formatQuantity(row: ConversionCandidateRow): string {
  if (row.quantity == null) return row.unit ?? "—";
  return `${row.quantity} ${row.unit ?? "(no unit)"}`.trim();
}

function Row({ row, ingredient }: { row: ConversionCandidateRow; ingredient: IngredientInfo }) {
  const [applied, setApplied] = useState<{ quantity: number; unit: string } | null>(null);

  async function apply(quantity: number, unit: string) {
    await applyPackagedUnitConversion(row.recipeIngredientId, ingredient.id, quantity, unit);
    setApplied({ quantity, unit });
  }

  const isActionable =
    row.matchType === "missing-unit" ||
    row.matchType === "density-assumed" ||
    row.matchType === "packaged-unit-mention" ||
    row.matchType === "gram-ratio-known";

  return (
    <tr className="border-t border-zinc-100">
      <td className="px-3 py-2 text-sm">
        <Link href={`/recipes/${row.recipeSlug}`} className="text-emerald-700 hover:underline">
          {row.recipeName}
        </Link>
      </td>
      <td className="px-3 py-2 text-sm text-zinc-600">{formatQuantity(row)}</td>
      <td className="px-3 py-2 text-sm">
        {applied ? (
          <span className="flex items-center gap-1 font-medium text-emerald-700">
            <Check className="h-4 w-4" /> {applied.quantity} {applied.unit}
          </span>
        ) : isActionable ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => apply(row.suggestedQuantity!, row.suggestedUnit!)}
              className="rounded-full border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Apply: {row.suggestedQuantity} {row.suggestedUnit}
            </button>
            {row.assumedDensity && (
              <span
                className="text-xs text-amber-600"
                title="Recipe is in grams, base unit is ml (or vice versa) — assumes ~1g ≈ 1ml"
              >
                assumes 1g≈1ml
              </span>
            )}
          </div>
        ) : row.matchType === "missing-unit-ambiguous" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => apply(row.suggestedQuantity!, row.suggestedUnit!)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400"
              title="Treat the bare number as already being in the base unit"
            >
              Already {row.suggestedQuantity} {row.suggestedUnit}
            </button>
            <button
              type="button"
              onClick={() => apply(row.alternateQuantity!, row.suggestedUnit!)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400"
              title={`Treat the bare number as a count of ${ingredient.packagedUnit ?? ""}`}
            >
              {row.quantity} {ingredient.packagedUnit} = {row.alternateQuantity} {row.suggestedUnit}
            </button>
          </div>
        ) : (
          <span className="text-xs text-zinc-400">{MATCH_TYPE_LABEL[row.matchType]}</span>
        )}
      </td>
    </tr>
  );
}

export default function IngredientConversionTable({
  rows,
  ingredient,
}: {
  rows: ConversionCandidateRow[];
  ingredient: IngredientInfo;
}) {
  if (rows.length === 0) {
    return <p className="mt-8 text-sm text-zinc-500">No recipes use this ingredient.</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200">
      <table className="w-full min-w-[700px] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <th className="px-3 py-2">Recipe</th>
            <th className="px-3 py-2">Current</th>
            <th className="px-3 py-2">Convert to</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.recipeIngredientId} row={row} ingredient={ingredient} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
