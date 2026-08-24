"use client";

import { X } from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchIngredients, type IngredientOption } from "@/lib/recipes/ingredientSearchAction";

/**
 * Free-text-with-autocomplete input for the pantry-match page: types into a
 * search box, picks from real canonical ingredients (never mints a new one —
 * see searchIngredients), gets a removable chip. Selection lives in the
 * `ingredients=` URL param rather than component state, same pattern as
 * FilterBar's filters, so the result page (a server component) can read it
 * directly and the picker stays in sync with back/forward navigation.
 */
export default function IngredientPicker({ selected }: { selected: IngredientOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<IngredientOption[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function navigateWithIds(ids: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length > 0) {
      params.set("ingredients", ids.join(","));
    } else {
      params.delete("ingredients");
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function addIngredient(option: IngredientOption) {
    if (selected.some((s) => s.id === option.id)) return;
    navigateWithIds([...selected.map((s) => s.id), option.id]);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  }

  function removeIngredient(id: string) {
    navigateWithIds(selected.filter((s) => s.id !== id).map((s) => s.id));
  }

  // Debounced autocomplete lookup as the user types.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      const results = await searchIngredients(q);
      if (!cancelled) {
        setSuggestions(results.filter((r) => !selected.some((s) => s.id === r.id)));
        setOpen(true);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selected.map((ing) => (
            <span
              key={ing.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium capitalize text-emerald-900"
            >
              {ing.canonicalName}
              <button
                type="button"
                onClick={() => removeIngredient(ing.id)}
                aria-label={`Remove ${ing.canonicalName}`}
                className="text-emerald-600 hover:text-emerald-900"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Add an ingredient you have..."
          className="w-full rounded-full border border-zinc-300 px-4 py-2 text-base sm:w-80 sm:text-sm"
        />
        {open && query.trim().length >= 2 && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full max-w-xs rounded-xl border border-zinc-200 bg-white py-1 shadow-lg sm:w-80">
            {suggestions.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => addIngredient(option)}
                  className="block w-full px-4 py-1.5 text-left text-sm capitalize text-zinc-700 hover:bg-zinc-50"
                >
                  {option.canonicalName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
