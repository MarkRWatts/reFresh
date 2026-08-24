"use client";

import { useState } from "react";
import type { IngredientCategory } from "@/generated/prisma/client";
import {
  renameOrMergeIngredient,
  updateIngredientCategory,
  updateIngredientNote,
  updateIngredientPackaging,
} from "@/lib/ingredients/actions";
import { INGREDIENT_CATEGORY_OPTIONS, type IngredientReviewRow } from "@/lib/ingredients/types";

const PACKAGED_UNIT_BASE_OPTIONS = ["g", "ml"];

const fieldClass = "rounded border border-zinc-200 px-2 py-1 text-sm";

function Row({ row }: { row: IngredientReviewRow }) {
  const [name, setName] = useState(row.canonicalName);
  const [category, setCategory] = useState(row.category);
  const [packagedUnit, setPackagedUnit] = useState(row.packagedUnit ?? "");
  const [packagedUnitQuantity, setPackagedUnitQuantity] = useState(
    row.packagedUnitQuantity != null ? String(row.packagedUnitQuantity) : "",
  );
  const [packagedUnitBase, setPackagedUnitBase] = useState(row.packagedUnitBase ?? "");
  const [note, setNote] = useState(row.shoppingListNote ?? "");
  const [mergedInto, setMergedInto] = useState<string | null>(null);

  if (mergedInto) {
    return (
      <tr className="border-t border-zinc-100">
        <td colSpan={7} className="px-3 py-2 text-sm text-zinc-500">
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

  function savePackaging(next: { unit?: string; quantity?: string; base?: string }) {
    const unit = next.unit ?? packagedUnit;
    const quantity = next.quantity ?? packagedUnitQuantity;
    const base = next.base ?? packagedUnitBase;
    // Blank or unparseable (e.g. mid-edit "1.") -> "not set" rather than
    // writing NaN — same convention as formFields.ts's numberField.
    const parsedQuantity = quantity.trim() ? Number(quantity) : NaN;
    updateIngredientPackaging(row.id, {
      packagedUnit: unit.trim() || null,
      packagedUnitQuantity: Number.isFinite(parsedQuantity) ? parsedQuantity : null,
      packagedUnitBase: base || null,
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
        <select
          value={packagedUnitBase}
          onChange={(e) => {
            setPackagedUnitBase(e.target.value);
            savePackaging({ base: e.target.value });
          }}
          className={fieldClass}
        >
          <option value="">—</option>
          {PACKAGED_UNIT_BASE_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
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
    </tr>
  );
}

export default function IngredientReviewTable({ rows }: { rows: IngredientReviewRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-8 text-sm text-zinc-500">No ingredients match that search.</p>;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200">
      <table className="w-full min-w-[1100px] border-collapse text-left">
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
            <th className="px-3 py-2">Substitution note</th>
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
