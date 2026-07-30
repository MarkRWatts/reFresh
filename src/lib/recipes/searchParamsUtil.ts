import type { ProteinType } from "@/generated/prisma/client";
import type { RecipeListParams, SortOption } from "./queries";

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const VALID_PROTEIN_TYPES: ProteinType[] = [
  "CHICKEN",
  "TURKEY",
  "BEEF",
  "LAMB",
  "PORK",
  "DUCK",
  "VENISON",
  "MEAT_OTHER",
  "FISH",
  "VEGETARIAN",
  "VEGAN",
];
const VALID_SORTS: SortOption[] = ["rating", "calories", "cookMinutes", "recent"];

export interface ParsedFilters {
  proteinTypes: ProteinType[];
  cuisine?: string;
  minCalories?: number;
  maxCalories?: number;
  minCookMinutes?: number;
  maxCookMinutes?: number;
  search?: string;
  favouritesOnly: boolean;
  sort: SortOption;
  page: number;
}

/** Parses the raw Next.js searchParams object into typed filter state, silently dropping anything malformed rather than erroring the page. */
export function parseFilters(raw: RawSearchParams): ParsedFilters {
  const proteinRaw = first(raw.protein);
  const proteinTypes = (proteinRaw?.split(",") ?? []).filter((p): p is ProteinType =>
    VALID_PROTEIN_TYPES.includes(p as ProteinType),
  );

  const toInt = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  const sortRaw = first(raw.sort);
  const sort = (VALID_SORTS.includes(sortRaw as SortOption) ? sortRaw : "rating") as SortOption;

  const page = Math.max(1, toInt(first(raw.page)) ?? 1);

  return {
    proteinTypes,
    cuisine: first(raw.cuisine) || undefined,
    minCalories: toInt(first(raw.minCal)),
    maxCalories: toInt(first(raw.maxCal)),
    minCookMinutes: toInt(first(raw.minTime)),
    maxCookMinutes: toInt(first(raw.maxTime)),
    search: first(raw.q) || undefined,
    favouritesOnly: first(raw.fav) === "1",
    sort,
    page,
  };
}

export function toListParams(filters: ParsedFilters, pageSize: number): RecipeListParams {
  return {
    proteinTypes: filters.proteinTypes.length > 0 ? filters.proteinTypes : undefined,
    cuisine: filters.cuisine,
    minCalories: filters.minCalories,
    maxCalories: filters.maxCalories,
    minCookMinutes: filters.minCookMinutes,
    maxCookMinutes: filters.maxCookMinutes,
    search: filters.search,
    favouritesOnly: filters.favouritesOnly,
    sort: filters.sort,
    page: filters.page,
    pageSize,
  };
}

/** Builds a query string from filter state, omitting empty values. Always resets `page` unless explicitly provided. */
export function buildFilterQueryString(
  filters: Partial<ParsedFilters> & { proteinTypes?: ProteinType[] },
): string {
  const params = new URLSearchParams();
  if (filters.proteinTypes && filters.proteinTypes.length > 0) {
    params.set("protein", filters.proteinTypes.join(","));
  }
  if (filters.cuisine) params.set("cuisine", filters.cuisine);
  if (filters.minCalories != null) params.set("minCal", String(filters.minCalories));
  if (filters.maxCalories != null) params.set("maxCal", String(filters.maxCalories));
  if (filters.minCookMinutes != null) params.set("minTime", String(filters.minCookMinutes));
  if (filters.maxCookMinutes != null) params.set("maxTime", String(filters.maxCookMinutes));
  if (filters.search) params.set("q", filters.search);
  if (filters.favouritesOnly) params.set("fav", "1");
  if (filters.sort && filters.sort !== "rating") params.set("sort", filters.sort);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
