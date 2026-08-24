"use client";

import Link from "next/link";
import { useState } from "react";
import type { IngredientCategory } from "@/generated/prisma/client";
import {
  renameOrMergeIngredient,
  updateIngredientCategory,
  updateIngredientNote,
  updateIngredientPackaging,
} from "@/lib/ingredients/actions";
import { INGREDIENT_CATEGORY_OPTIONS, type IngredientReviewRow } from "@/lib/ingredients/types";

const COMMON_BASE_UNITS = ["g", "ml", "tbsp", "tsp"];

const fieldClass = "rounded border border-zinc-200 px-2 py-1 text-sm";

function Row({ row }: { row: IngredientReviewRow }) {
  const [name, setName] = useState(row.canonicalName);
  const [category, setCategory] = useState(row.category);
  const [packagedUnit, setPackagedUnit] = useState(row.packagedUnit ?? "");
  const [packagedUnitQuantity, setPackagedUnitQuantity] = useState(
    row.packagedUnitQuantity != null ? String(row.packagedUnitQuantity) : "",
  );
  const [packagedUnitBase, setPackagedUnitBase] = useState(row.packagedUnitBase ?? "");
  const [packagedUnitBaseGrams, setPackagedUnitBaseGrams] = useState(
    row.packagedUnitBaseGrams != null ? String(row.packagedUnitBaseGrams) : "",
  );
  const [note, setNote] = useState(row.shoppingListNote ?? "");
  const [mergedInto, setMergedInto] = useState<string | null>(null);

  if (mergedInto) {
    return (
      <tr className="border-t border-zinc-100">
        <td colSpan={9} className="px-3 py-2 text-sm text-zinc-500">
          <span className="italic">&ldquo;{row.canonicalName}&rdquo;</span> merged into{" "}
          <span className="font-medium capitalize">{mergedInto}</span>.
        </td>
      </tr>
    );
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === row.canonicalName) {
      setName(row.canonicalName);
      return;
    }
    const result = await renameOrMergeIngredient(row.id, trimmed);
    if (result.mergedInto) setMergedInto(result.mergedInto);
    else setName(trimmed);
  }

  function savePackaging(next: { unit?: string; quantity?: string; base?: string; baseGrams?: string }) {
    const unit = next.unit ?? packagedUnit;
    const quantity = next.quantity ?? packagedUnitQuantity;
    const base = next.base ?? packagedUnitBase;
    const baseGrams = next.baseGrams ?? packagedUnitBaseGrams;
    // Blank or unparseable (e.g. mid-edit "1.") -> "not set" rather than
    // writing NaN — same convention as formFields.ts's numberField.
    const parsedQuantity = quantity.trim() ? Number(quantity) : NaN;
    const parsedBaseGrams = baseGrams.trim() ? Number(baseGrams) : NaN;
    updateIngredientPackaging(row.id, {
      packagedUnit: unit.trim() || null,
      packagedUnitQuantity: Number.isFinite(parsedQuantity) ? parsedQuantity : null,
      packagedUnitBase: base || null,
      packagedUnitBaseGrams: Number.isFinite(parsedBaseGrams) ? parsedBaseGrams : null,
    });
  }

  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="px-3 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          className={`w-96 capitalize ${fieldClass}`}
        />
      </td>
      <td className="px-3 py-2 text-sm text-zinc-500">
        {row.usageCount}
        {row.totalUsageCount > row.usageCount && (
          <span
            className="ml-1 text-xs text-zinc-400"
            title="The rest are from recipes that never actually show up in the app (draft/test/removed)"
          >
            ({row.totalUsageCount} total)
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          value={category}
          onChange={(e) => {
            const value = e.target.value as IngredientCategory;
            setCategory(value);
            updateIngredientCategory(row.id, value);
          }}
          className={fieldClass}
        >
          {INGREDIENT_CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          list={`units-${row.id}`}
          value={packagedUnit}
          onChange={(e) => setPackagedUnit(e.target.value)}
          onBlur={() => savePackaging({ unit: packagedUnit })}
          placeholder={row.unitsSeen[0] ?? "e.g. pot(s)"}
          className={`w-28 ${fieldClass}`}
        />
        <datalist id={`units-${row.id}`}>
          {row.unitsSeen.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="decimal"
          value={packagedUnitQuantity}
          onChange={(e) => setPackagedUnitQuantity(e.target.value)}
          onBlur={() => savePackaging({ quantity: packagedUnitQuantity })}
          placeholder="e.g. 150"
          className={`w-20 ${fieldClass}`}
        />
      </td>
      <td className="px-3 py-2">
        <input
          list={`base-units-${row.id}`}
          value={packagedUnitBase}
          onChange={(e) => setPackagedUnitBase(e.target.value)}
          onBlur={() => savePackaging({ base: packagedUnitBase })}
          placeholder="g"
          className={`w-20 ${fieldClass}`}
        />
        <datalist id={`base-units-${row.id}`}>
          {COMMON_BASE_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="decimal"
          value={packagedUnitBaseGrams}
          onChange={(e) => setPackagedUnitBaseGrams(e.target.value)}
          onBlur={() => savePackaging({ baseGrams: packagedUnitBaseGrams })}
          placeholder="e.g. 15"
          title="Only needed when the base unit above isn't g/ml — how many grams equal one of it (e.g. 15 for a tbsp of honey)"
          className={`w-20 ${fieldClass}`}
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => updateIngredientNote(row.id, note)}
          placeholder="No direct equivalent — mix..."
          className={`w-56 ${fieldClass}`}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <Link href={`/ingredients/review/${row.id}/convert`} className="text-emerald-700 hover:underline">
          Review recipes →
        </Link>
      </td>
    </tr>
  );
}

export default function IngredientReviewTable({ rows }: { rows: IngredientReviewRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-8 text-sm text-zinc-500">No ingredients match that search.</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200">
      <table className="w-full min-w-[1250px] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2" title="Only counts recipes that actually appear in the app (not draft/test/removed)">
              Uses
            </th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Packaged unit</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Base</th>
            <th className="px-3 py-2" title="Only needed when Base isn't g/ml — grams per one Base unit (e.g. 15 for a tbsp of honey)">
              Base grams
            </th>
            <th className="px-3 py-2">Substitution note</th>
            <th
              className="px-3 py-2"
              title="Compare each recipe's actual amount against the packaged size and convert the clean matches"
            >
              Convert
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
