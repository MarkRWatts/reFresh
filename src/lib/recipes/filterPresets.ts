import type { ProteinType } from "@/generated/prisma/client";

export const PROTEIN_TYPE_OPTIONS: { value: ProteinType; label: string }[] = [
  { value: "MEAT", label: "Meat" },
  { value: "FISH", label: "Fish" },
  { value: "VEGETARIAN", label: "Vegetarian" },
  { value: "VEGAN", label: "Vegan" },
];

export interface RangePreset {
  key: string;
  label: string;
  min?: number;
  max?: number;
}

export const CALORIE_PRESETS: RangePreset[] = [
  { key: "any", label: "Any calories" },
  { key: "lt400", label: "Under 400", max: 399 },
  { key: "400-700", label: "400–700", min: 400, max: 700 },
  { key: "gt700", label: "700+", min: 701 },
];

export const COOK_TIME_PRESETS: RangePreset[] = [
  { key: "any", label: "Any time" },
  { key: "lt20", label: "Under 20 min", max: 19 },
  { key: "20-40", label: "20–40 min", min: 20, max: 40 },
  { key: "gt40", label: "40+ min", min: 41 },
];

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "rating", label: "Top rated" },
  { value: "calories", label: "Lowest calories" },
  { value: "cookMinutes", label: "Quickest" },
  { value: "recent", label: "Recently added" },
];

export const PROTEIN_BADGE_STYLES: Record<ProteinType, string> = {
  MEAT: "bg-red-50 text-red-700 border-red-200",
  FISH: "bg-blue-50 text-blue-700 border-blue-200",
  VEGETARIAN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VEGAN: "bg-teal-50 text-teal-700 border-teal-200",
  UNKNOWN: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export const PROTEIN_LABELS: Record<ProteinType, string> = {
  MEAT: "Meat",
  FISH: "Fish",
  VEGETARIAN: "Vegetarian",
  VEGAN: "Vegan",
  UNKNOWN: "Unclassified",
};
