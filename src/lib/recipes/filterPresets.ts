import type { ProteinType } from "@/generated/prisma/client";

export const PROTEIN_TYPE_OPTIONS: { value: ProteinType; label: string }[] = [
  { value: "CHICKEN", label: "Chicken" },
  { value: "TURKEY", label: "Turkey" },
  { value: "BEEF", label: "Beef" },
  { value: "LAMB", label: "Lamb" },
  { value: "PORK", label: "Pork" },
  { value: "MEAT_OTHER", label: "Other Meat" },
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

interface ProteinColorSet {
  /** Light "pill" styling — recipe cards, the detail page, and inactive filter buttons. */
  badge: string;
  /** Solid styling for a selected/active filter button. */
  active: string;
}

// One color per protein type, shared by every pill in the app (cards,
// detail page, filter bar) so the same protein always reads the same color
// everywhere. Chicken/Turkey/Beef/Lamb/Pork are the user-specified palette;
// the rest extend it consistently.
export const PROTEIN_COLORS: Record<ProteinType, ProteinColorSet> = {
  CHICKEN: {
    badge: "bg-orange-50 text-orange-700 border-orange-200",
    active: "bg-orange-600 text-white border-orange-600",
  },
  TURKEY: {
    badge: "bg-purple-50 text-purple-700 border-purple-200",
    active: "bg-purple-600 text-white border-purple-600",
  },
  BEEF: {
    badge: "bg-red-50 text-red-700 border-red-200",
    active: "bg-red-600 text-white border-red-600",
  },
  LAMB: {
    badge: "bg-green-50 text-green-800 border-green-300",
    active: "bg-green-700 text-white border-green-700",
  },
  PORK: {
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
    active: "bg-indigo-600 text-white border-indigo-600",
  },
  MEAT_OTHER: {
    badge: "bg-stone-100 text-stone-700 border-stone-300",
    active: "bg-stone-600 text-white border-stone-600",
  },
  FISH: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    active: "bg-blue-600 text-white border-blue-600",
  },
  VEGETARIAN: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    active: "bg-emerald-600 text-white border-emerald-600",
  },
  VEGAN: {
    badge: "bg-teal-50 text-teal-700 border-teal-200",
    active: "bg-teal-600 text-white border-teal-600",
  },
  UNKNOWN: {
    badge: "bg-zinc-100 text-zinc-600 border-zinc-200",
    active: "bg-zinc-600 text-white border-zinc-600",
  },
};

export const PROTEIN_BADGE_STYLES: Record<ProteinType, string> = Object.fromEntries(
  (Object.entries(PROTEIN_COLORS) as [ProteinType, ProteinColorSet][]).map(([type, colors]) => [
    type,
    colors.badge,
  ]),
) as Record<ProteinType, string>;

export const PROTEIN_LABELS: Record<ProteinType, string> = {
  CHICKEN: "Chicken",
  TURKEY: "Turkey",
  BEEF: "Beef",
  LAMB: "Lamb",
  PORK: "Pork",
  MEAT_OTHER: "Other Meat",
  FISH: "Fish",
  VEGETARIAN: "Vegetarian",
  VEGAN: "Vegan",
  UNKNOWN: "Unclassified",
};
