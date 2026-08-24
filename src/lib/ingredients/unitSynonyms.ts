// Raw HelloFresh unit strings that mean the same physical unit but appear
// inconsistently across recipes/imports (e.g. "grams" on one recipe, "g"
// on another) — folded together so quantities in the same real unit
// actually combine instead of splitting into near-duplicate buckets.
// Shared between the shopping-list summer (sharedIngredients.ts), the
// packaged-unit conversion reviewer (conversionQueries.ts), and — as of
// this table becoming complete — the import-time parser
// (ingredientParser.ts's normalizeUnit), so newly-scraped rows are stored
// pre-folded rather than needing another reparse pass later. Every surface
// form in ingredientParser.ts's UNIT_WORD_SET is covered here so the two
// files can't drift out of sync with each other.
//
// Existing rows already in the DB under an un-folded spelling (e.g.
// "pot(s)") are NOT rewritten by this table — only comparisons need both
// sides normalized (see normalizeUnitLabel call sites), so old and new
// spellings keep matching each other without a backfill.
const UNIT_SYNONYMS: Record<string, string> = {
  gram: "g",
  grams: "g",
  kilograms: "kg",
  milliliter: "ml",
  milliliters: "ml",
  millilitres: "ml",
  "milliliter(s)": "ml",
  "millilitre(s)": "ml",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  tbsps: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsps: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  cups: "cup",
  "clove(s)": "clove",
  cloves: "clove",
  "sachet(s)": "sachet",
  sachets: "sachet",
  "bunch(es)": "bunch",
  bunches: "bunch",
  "ball(s)": "ball",
  balls: "ball",
  "pinch(es)": "pinch",
  pinches: "pinch",
  "pack(s)": "pack",
  packs: "pack",
  "ounce(s)": "oz",
  ounces: "oz",
  ounce: "oz",
  "slice(s)": "slice",
  slices: "slice",
  "piece(s)": "piece",
  pieces: "piece",
  "block(s)": "block",
  blocks: "block",
  "carton(s)": "carton",
  cartons: "carton",
  "pot(s)": "pot",
  pots: "pot",
  "tin(s)": "tin",
  tins: "tin",
  "jar(s)": "jar",
  jars: "jar",
  "punnet(s)": "punnet",
  punnets: "punnet",
  "bottle(s)": "bottle",
  bottles: "bottle",
  "bag(s)": "bag",
  bags: "bag",
  "handful(s)": "handful",
  handfuls: "handful",
};

export function normalizeUnitLabel(unit: string | null): string | null {
  if (unit == null) return null;
  return UNIT_SYNONYMS[unit] ?? unit;
}

export function isPackagedUnitMention(unit: string | null, packagedUnit: string): boolean {
  const normalized = normalizeUnitLabel(unit);
  if (normalized == null) return false;
  // HelloFresh labels a single packaged container "sachet" regardless of
  // what the ingredient itself is packaged as (a stock cube's foil sachet,
  // a stock pot's plastic sachet) — an alias for "one packagedUnit", not a
  // fixed physical unit.
  return normalized === normalizeUnitLabel(packagedUnit) || normalized === "sachet";
}
