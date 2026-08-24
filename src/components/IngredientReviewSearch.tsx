"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { INGREDIENT_SORT_OPTIONS, type IngredientSortOption } from "@/lib/ingredients/types";

/** Debounced search box + sort select for the ingredient review page — same 350ms-debounce-then-navigate pattern as FilterBar's recipe search, kept separate since this page's URL params (q/sort/page only) aren't shaped like ParsedFilters. Changing either control resets to page 1, same as FilterBar's navigate(). */
export default function IngredientReviewSearch({
  initialValue,
  initialSort,
}: {
  initialValue: string;
  initialSort: IngredientSortOption;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialValue);
  const [sort, setSort] = useState(initialSort);
  const isFirstRender = useRef(true);

  function navigate(nextValue: string, nextSort: IngredientSortOption) {
    const params = new URLSearchParams();
    if (nextValue) params.set("q", nextValue);
    if (nextSort !== "usage_desc") params.set("sort", nextSort);
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => navigate(value, sort), 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search ingredients..."
        className="w-full rounded-full border border-zinc-300 px-4 py-1.5 text-base sm:w-72 sm:text-sm"
      />
      <select
        value={sort}
        onChange={(e) => {
          const nextSort = e.target.value as IngredientSortOption;
          setSort(nextSort);
          navigate(value, nextSort);
        }}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700"
      >
        {INGREDIENT_SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            Sort: {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
