"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ProteinType } from "@/generated/prisma/client";
import HeartIcon from "@/components/icons/HeartIcon";
import {
  CALORIE_PRESETS,
  COOK_TIME_PRESETS,
  PROTEIN_COLORS,
  PROTEIN_TYPE_OPTIONS,
  SORT_OPTIONS,
  type RangePreset,
} from "@/lib/recipes/filterPresets";
import { buildFilterQueryString, type ParsedFilters } from "@/lib/recipes/searchParamsUtil";

function pillClasses(active: boolean): string {
  return [
    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
    active
      ? "border-zinc-900 bg-zinc-900 text-white"
      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400",
  ].join(" ");
}

// Protein filter pills use the same per-protein color as the card/detail
// badges (PROTEIN_COLORS) instead of the generic black/white active state,
// so a pill's color always identifies the same protein everywhere.
function proteinPillClasses(value: ProteinType, active: boolean): string {
  const colors = PROTEIN_COLORS[value];
  return [
    "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
    active ? colors.active : `${colors.badge} hover:opacity-75`,
  ].join(" ");
}

function favouritesPillClasses(active: boolean): string {
  return [
    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
    active
      ? "border-pink-500 bg-pink-50 text-pink-600"
      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400",
  ].join(" ");
}

function importedPillClasses(active: boolean): string {
  return [
    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
    active
      ? "border-sky-500 bg-sky-50 text-sky-700"
      : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400",
  ].join(" ");
}

function activeRangePreset(presets: RangePreset[], min?: number, max?: number): string {
  const match = presets.find((p) => p.min === min && p.max === max);
  return match?.key ?? "any";
}

export default function FilterBar({
  filters,
  cuisines,
}: {
  filters: ParsedFilters;
  cuisines: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(filters.search ?? "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const isFirstRender = useRef(true);

  function navigate(next: Partial<ParsedFilters>) {
    const merged: ParsedFilters = { ...filters, page: 1, ...next };
    router.push(`${pathname}${buildFilterQueryString(merged)}`, { scroll: false });
  }

  function toggleProtein(value: ProteinType) {
    const has = filters.proteinTypes.includes(value);
    const proteinTypes = has
      ? filters.proteinTypes.filter((p) => p !== value)
      : [...filters.proteinTypes, value];
    navigate({ proteinTypes });
  }

  function toggleFavouritesOnly() {
    navigate({ favouritesOnly: !filters.favouritesOnly });
  }

  function toggleImportedOnly() {
    navigate({ importedOnly: !filters.importedOnly });
  }

  function toggleShowAll() {
    navigate({ showAll: !filters.showAll });
  }

  function selectCaloriePreset(preset: RangePreset) {
    navigate({ minCalories: preset.min, maxCalories: preset.max });
  }

  function selectCookTimePreset(preset: RangePreset) {
    navigate({ minCookMinutes: preset.min, maxCookMinutes: preset.max });
  }

  // Debounce the free-text search so every keystroke doesn't trigger a navigation.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      if (searchValue !== (filters.search ?? "")) {
        navigate({ search: searchValue || undefined });
      }
    }, 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  const activeCaloriePreset = activeRangePreset(
    CALORIE_PRESETS,
    filters.minCalories,
    filters.maxCalories,
  );
  const activeCookTimePreset = activeRangePreset(
    COOK_TIME_PRESETS,
    filters.minCookMinutes,
    filters.maxCookMinutes,
  );

  const activeFilterCount =
    (filters.favouritesOnly ? 1 : 0) +
    (filters.importedOnly ? 1 : 0) +
    filters.proteinTypes.length +
    (filters.cuisine ? 1 : 0) +
    (activeCaloriePreset !== "any" ? 1 : 0) +
    (activeCookTimePreset !== "any" ? 1 : 0) +
    (filters.showAll ? 1 : 0);

  return (
    <div className="sticky top-[61px] z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search recipes..."
            className="w-full rounded-full border border-zinc-300 px-4 py-1.5 text-base sm:w-56 sm:text-sm"
          />

          <button
            type="button"
            onClick={() => setMobileFiltersOpen((open) => !open)}
            className={`sm:hidden ${pillClasses(mobileFiltersOpen)}`}
            aria-expanded={mobileFiltersOpen}
            aria-controls="filter-bar-extras"
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">
                {activeFilterCount}
              </span>
            )}
            <span className="ml-1">{mobileFiltersOpen ? "▲" : "▼"}</span>
          </button>

          {/*
           * On mobile this is a collapsible panel below the search row so
           * the filter pills don't push the recipe grid down by default;
           * `sm:contents` drops the wrapper at the sm breakpoint so its
           * children flow inline in the row exactly as before.
           */}
          <div
            id="filter-bar-extras"
            className={`${mobileFiltersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 sm:contents`}
          >
            <button
              type="button"
              onClick={toggleFavouritesOnly}
              className={favouritesPillClasses(filters.favouritesOnly)}
            >
              <HeartIcon filled={filters.favouritesOnly} className="h-4 w-4" />
              Favourites
            </button>

            <button
              type="button"
              onClick={toggleImportedOnly}
              className={importedPillClasses(filters.importedOnly)}
            >
              📄 Imported
            </button>

            {PROTEIN_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleProtein(option.value)}
                className={proteinPillClasses(option.value, filters.proteinTypes.includes(option.value))}
              >
                {option.label}
              </button>
            ))}

            <select
              value={filters.cuisine ?? ""}
              onChange={(e) => navigate({ cuisine: e.target.value || undefined })}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700"
            >
              <option value="">All cuisines</option>
              {cuisines.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              {CALORIE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => selectCaloriePreset(preset)}
                  className={pillClasses(activeCaloriePreset === preset.key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              {COOK_TIME_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => selectCookTimePreset(preset)}
                  className={pillClasses(activeCookTimePreset === preset.key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleShowAll}
              title="Also show near-duplicate recipes that are normally hidden behind their primary"
              className={pillClasses(filters.showAll)}
            >
              Show all recipes
            </button>

            <select
              value={filters.sort}
              onChange={(e) => navigate({ sort: e.target.value as ParsedFilters["sort"] })}
              className="sm:ml-auto rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort: {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
