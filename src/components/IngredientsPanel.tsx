"use client";

import { useState } from "react";

interface IngredientRow {
  id: string;
  quantity: number | null;
  unit: string | null;
  name: string;
}

const SERVING_OPTIONS = [2, 3, 4];

function pillClasses(active: boolean): string {
  return [
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-zinc-900 bg-zinc-900 text-white"
      : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400",
  ].join(" ");
}

function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 100) / 100);
}

/** Ingredients box with a 2/3/4-person picker that scales every displayed quantity — pure client-side arithmetic, no server round-trip needed. */
export default function IngredientsPanel({
  ingredients,
  baseServings,
}: {
  ingredients: IngredientRow[];
  baseServings: number | null;
}) {
  const [selectedServings, setSelectedServings] = useState(baseServings ?? SERVING_OPTIONS[0]);
  const multiplier = baseServings ? selectedServings / baseServings : 1;

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Ingredients</h2>
        {baseServings != null && (
          <div className="flex items-center gap-1 print:hidden">
            {SERVING_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSelectedServings(n)}
                className={pillClasses(selectedServings === n)}
              >
                {n}p
              </button>
            ))}
          </div>
        )}
      </div>
      {baseServings != null && selectedServings !== baseServings && (
        <p className="mt-1 text-xs text-zinc-400">Scaled from {baseServings}-serving quantities</p>
      )}
      <ul className="mt-2 space-y-1.5 text-sm text-zinc-600">
        {ingredients.map((ri) => (
          <li key={ri.id}>
            {ri.quantity != null && (
              <span className="text-zinc-400">{formatQuantity(ri.quantity * multiplier)} </span>
            )}
            {ri.unit && <span className="text-zinc-400">{ri.unit} </span>}
            {ri.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
