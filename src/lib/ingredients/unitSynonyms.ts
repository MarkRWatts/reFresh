// Raw HelloFresh unit strings that mean the same physical unit but appear
// inconsistently across recipes/imports (e.g. "grams" on one recipe, "g"
// on another) — folded together so quantities in the same real unit
// actually combine instead of splitting into near-duplicate buckets.
// Shared between the shopping-list summer (sharedIngredients.ts) and the
// packaged-unit conversion reviewer (conversionQueries.ts).
const UNIT_SYNONYMS: Record<string, string> = {
  gram: "g",
  grams: "g",
  milliliter: "ml",
  milliliters: "ml",
  "milliliter(s)": "ml",
};

export function normalizeUnitLabel(unit: string | null): string | null {
  if (unit == null) return null;
  return UNIT_SYNONYMS[unit] ?? unit;
}
