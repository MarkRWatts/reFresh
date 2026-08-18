import { splitNameAndSubtitle } from "@/lib/scraper/fieldParsers";
import { parseIngredientLine } from "@/lib/scraper/ingredientParser";
import { recognizeText, recognizeLines, type OcrLine } from "./ocr";
import { rasterizePdf, type RasterPage } from "./rasterize";
import { deskewPage, findAnchor, findColumnHeaderPositions } from "./deskew";
import { isReddishLine } from "./colorDetect";
import {
  cropRegion,
  shiftIngredientsRegion,
  shiftNutritionRegion,
  unionRegion,
  CARD_TEMPLATES,
  type CardTemplate,
  type FractionalRegion,
  type IngredientsRegion,
  type NutritionRegion,
  type StepsRegion,
} from "./regions";

export interface ParsedCardQuantity {
  quantity: number | null;
  unit: string | null;
  rawText: string;
}

export interface ParsedCardIngredientRow {
  /** The ingredient name, read once independent of how well any individual serving column's quantity happened to OCR, so one column's misread digit can't corrupt the name (it used to, when the name was derived by re-parsing "<qty> <name>" per column and taking whichever one parsed first). */
  name: string;
  /** One quantity per serving-count column (see CardTemplate.servingCounts), e.g. index 0 is the 2-person quantity. Null wherever OCR didn't produce a recognizable leading number — the review screen is expected to fix these. */
  byServing: ParsedCardQuantity[];
}

export interface ParsedCardStep {
  heading: string | null;
  text: string;
  /** Null when this step has no photo on the card — either the layout never had one for this step, or (for a "flowing" step layout, see regions.ts) photos couldn't be reliably matched to steps at all. */
  photo: Buffer | null;
  /** The exact crop OCR read this step's text from — shown next to the instructions field on the review screen so a misread is easy to spot. Null for a "flowing" step layout (see regions.ts), where steps are split out of shared multi-step text after the fact and have no crop of their own. */
  textCrop: Buffer | null;
}

export interface ParsedCardRecipe {
  templateId: string;
  name: string;
  subtitle: string | null;
  cookMinutes: number | null;
  coverPhoto: Buffer;
  /** The union of the ingredient table/list's sub-regions, as one crop — see regions.ts's unionRegion. Shown on the review screen next to the ingredient rows it produced. Null only if the layout defines no columns at all, which shouldn't happen in practice. */
  ingredientsCrop: Buffer | null;
  /** Same idea as ingredientsCrop, for whichever nutrition sub-regions were actually read (including a detected swap-block second column, see correctPage2Regions). */
  nutritionCrop: Buffer | null;
  servingCounts: number[];
  ingredients: ParsedCardIngredientRow[];
  calories: number | null;
  fatGrams: number | null;
  saturatedFatGrams: number | null;
  carbsGrams: number | null;
  sugarGrams: number | null;
  proteinGrams: number | null;
  saltGrams: number | null;
  fiberGrams: number | null;
  /**
   * A second nutrition column read off a "Custom Recipe" swap block (see
   * e.g. Bacon Leek and Mushroom Pie's optional chicken) — present only when
   * the card actually has one (detected via a second "Per serving" header,
   * see correctPage2Regions). Review-screen-only: there's no persisted
   * dual-nutrition-set column on Recipe, this is just surfaced so the user
   * can see both figures and pick the right one for what they'll actually
   * cook.
   */
  nutritionWithOptionalIngredient: NutritionFields | null;
  steps: ParsedCardStep[];
  /** Fields that came back empty/ambiguous — surfaced on the review screen rather than silently dropped. */
  warnings: string[];
}

export type NutritionFields = Pick<
  ParsedCardRecipe,
  "calories" | "fatGrams" | "saturatedFatGrams" | "carbsGrams" | "sugarGrams" | "proteinGrams" | "saltGrams" | "fiberGrams"
>;

function emptyNutritionFields(): NutritionFields {
  return {
    calories: null,
    fatGrams: null,
    saturatedFatGrams: null,
    carbsGrams: null,
    sugarGrams: null,
    proteinGrams: null,
    saltGrams: null,
    fiberGrams: null,
  };
}

/** A ParsedCardRecipe with its image Buffers stripped out — the JSON-safe shape persisted on PdfImportDraft.data. Images live on disk instead (see imageStorage.ts), addressed by draft id + a fixed naming convention rather than a path stored here. */
export type DraftRecipeData = Omit<ParsedCardRecipe, "coverPhoto" | "ingredientsCrop" | "nutritionCrop" | "steps"> & {
  steps: Array<Omit<ParsedCardStep, "photo" | "textCrop">>;
};

export function toDraftRecipeData(parsed: ParsedCardRecipe): DraftRecipeData {
  const { coverPhoto: _coverPhoto, ingredientsCrop: _ingredientsCrop, nutritionCrop: _nutritionCrop, steps, ...rest } = parsed;
  return {
    ...rest,
    steps: steps.map(({ heading, text }) => ({ heading, text })),
  };
}

export class UnsupportedCardLayoutError extends Error {}

function linesOf(ocrText: string): string[] {
  return ocrText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * A long ingredient name (often one carrying trailing allergen-footnote
 * markers, e.g. "Ketjap Manis 11) 13)") can wrap onto a second line inside
 * the narrow name column, which would otherwise read as an extra phantom
 * row. A wrapped continuation is short and made up of little besides
 * digits/punctuation, so folding any such line into the previous one
 * recovers the original row count (keeping the first line's y, since that's
 * the row's true position for matching against the quantity columns).
 */
function mergeWrappedNameLines(lines: OcrLine[]): OcrLine[] {
  const merged: OcrLine[] = [];
  for (const line of lines) {
    const looksLikeContinuation = merged.length > 0 && /^[\d\s|).]{1,6}$/.test(line.text);
    if (looksLikeContinuation) {
      const prev = merged[merged.length - 1];
      merged[merged.length - 1] = { text: `${prev.text} ${line.text}`.trim(), y: prev.y, baseline: prev.baseline };
    } else {
      merged.push(line);
    }
  }
  return merged;
}

/**
 * Matches each anchor line to whichever candidate line sits closest to it
 * vertically, consuming candidates as they're matched. Two narrow crops of
 * the same row span don't reliably segment into the same number of OCR
 * lines (a wrapped word, a stray smudge, a missed row) — matching by
 * position instead of list index means one crop's hiccup doesn't shift
 * every row after it out of alignment with the other crop.
 */
function matchByNearestY<T extends { y: number }>(anchors: OcrLine[], candidates: T[]): (T | null)[] {
  const remaining = [...candidates];
  return anchors.map((anchor) => {
    if (remaining.length === 0) return null;
    let bestIndex = 0;
    let bestDistance = Math.abs(remaining[0].y - anchor.y);
    for (let i = 1; i < remaining.length; i++) {
      const distance = Math.abs(remaining[i].y - anchor.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return remaining.splice(bestIndex, 1)[0];
  });
}

// The HelloFresh wordmark sits immediately left of the title and varies in
// width across print runs — some cards' logos are narrow enough that the
// title crop's left edge clears them cleanly, others bleed a fragment of
// "HELLO"/"FRESH" into the OCR text (e.g. "IELLO ... RESH" when the "H"/"F"
// get dropped). Tuning the crop tighter per card isn't worth chasing; both
// real words and their common OCR misreads always contain "ELLO"/"RESH",
// which no real recipe name does, so stripping leading words that do is a
// safe general cleanup.
function stripLogoNoise(text: string): string {
  const words = text.split(/\s+/);
  let start = 0;
  while (start < words.length && start < 3) {
    const w = words[start].toUpperCase();
    if (w.length <= 6 && (w.includes("ELLO") || w.includes("RESH"))) start++;
    else break;
  }
  return words.slice(start).join(" ");
}

function parseTitleBlock(ocrText: string): { name: string | null; subtitle: string | null } {
  const lines = linesOf(ocrText);
  if (lines.length === 0) return { name: null, subtitle: null };
  const { name, subtitle } = splitNameAndSubtitle(stripLogoNoise(lines.join(" ")));
  return { name, subtitle };
}

/** Finds a total-time figure anywhere in the given text — cards differ on whether it's phrased "Total Time: 35 Minutes", a bare "40 Minutes", or a range "40-45 Minutes", so this deliberately doesn't anchor to one exact phrasing. */
function parseTimeText(ocrText: string): number | null {
  const totalMatch = /total time:?\s*(\d+)/i.exec(ocrText);
  const anyMatch = /(\d+)\s*-?\s*(?:\d+\s*)?min/i.exec(ocrText);
  const value = totalMatch?.[1] ?? anyMatch?.[1];
  return value ? Number(value) : null;
}

// Not every card's ingredient table is the same length (a "Custom Recipe"
// swap block or a "Pantry" sub-table can add rows), so the crop region is
// deliberately generous rather than tuned to one exact row count — it can
// run on into the nutrition/allergens text below. "Pantry"/"Ingredients"
// are sub-headings within the table (dropped, not real rows); the first
// line that looks like it's actually the nutrition section or a footnote
// means the real table has ended (everything from there on is discarded).
const NON_INGREDIENT_LINE = /^(ingredients?|pantry)$/i;
const INGREDIENT_LIST_END = /nutrition|values|allergen|not included|contact/i;

function cleanIngredientNameLines(lines: OcrLine[]): OcrLine[] {
  const cleaned: OcrLine[] = [];
  for (const line of lines) {
    if (INGREDIENT_LIST_END.test(line.text)) break;
    if (NON_INGREDIENT_LINE.test(line.text)) continue;
    cleaned.push(line);
  }
  return cleaned;
}

/**
 * Parses a bare quantity cell like "2 cloves", "½ piece", or "1 small pot"
 * into quantity/unit. Reuses the HelloFresh-website scraper's tokenizer
 * (ingredientParser.ts), which expects a full "<qty> <unit> <name>" string
 * to tell a unit token from a name — a placeholder name is appended and
 * discarded, since the real name is read separately (see above) rather
 * than re-derived per serving column.
 */
// OCR sometimes drops the space between a number and its unit ("1tbsp",
// "250g") — the tokenizer requires one to tell where the quantity token
// ends, so without it the whole cell/line falls through unparsed.
function insertDigitUnitSpace(text: string): string {
  return text.replace(/^(\d+(?:\.\d+)?)([a-zA-Z]+)/, "$1 $2");
}

// A bulleted list's "•" marker regularly OCRs as some other short symbol
// glued to the front of the line ("@", "®", "¢", a stray "e") rather than
// clean whitespace — left in place, that symbol isn't a digit or letter, so
// it blocks the tokenizer's "must start with a quantity" check from ever
// matching. Also strips a matching stray trailing symbol (seemingly a
// colour-coding marker on some cards). Unicode vulgar fractions (½ etc.)
// are excluded from what counts as "noise" since they're real quantities.
const OCR_NOISE_CHAR = "[^\\w¼½¾⅓⅔⅛⅜⅝⅞]";
function stripBulletNoise(line: string): string {
  return line
    .replace(new RegExp(`^${OCR_NOISE_CHAR}+`), "")
    .replace(new RegExp(`${OCR_NOISE_CHAR}+$`), "")
    .trim();
}

// The "½" glyph is small enough at print size that Tesseract's English
// model very rarely reads it as itself — but it's consistently misread as
// "Ya" (seen across several different cards/crops, not a one-off), unlike
// the *other* common failure mode of reading it as some unrelated plain
// digit. A plain-digit misread ("2" instead of "½") is indistinguishable
// from a genuine "2" and isn't safe to "fix" — but "Ya" is never a real
// quantity token, so correcting that one specific, repeatable pattern is
// safe where guessing at digits wouldn't be.
function fixFractionMisreads(token: string): string {
  return token.replace(/^Ya$/i, "½");
}

function parseQuantityCell(cellText: string | null): ParsedCardQuantity {
  if (!cellText) return { quantity: null, unit: null, rawText: "" };
  const normalized = cellText
    .split(/\s+/)
    .map(fixFractionMisreads)
    .join(" ");
  const { quantity, unit } = parseIngredientLine(`${insertDigitUnitSpace(normalized)} placeholder`);
  return { quantity, unit, rawText: cellText };
}

async function parseIngredientTableLayout(
  page: { png: Buffer; width: number; height: number },
  region: Extract<IngredientsRegion, { layout: "table" }>,
  warnings: string[],
): Promise<ParsedCardIngredientRow[]> {
  const nameCrop = await cropRegion(page.png, page.width, page.height, region.nameColumn);
  const names = cleanIngredientNameLines(mergeWrappedNameLines(await recognizeLines(nameCrop)));

  // OCR calls share a single Tesseract worker (see ocr.ts) which isn't safe
  // to run concurrently against — parallel recognize() calls were observed
  // to corrupt each other's results. Sequential is slower but correct.
  const qtyColumns: (OcrLine | null)[][] = [];
  for (const qtyRegion of region.qtyColumns) {
    const crop = await cropRegion(page.png, page.width, page.height, qtyRegion);
    const lines = await recognizeLines(crop);
    if (lines.length < names.length) {
      warnings.push(
        `Ingredient table: a quantity column found only ${lines.length} of ${names.length} rows — some cells may be blank, check carefully.`,
      );
    }
    qtyColumns.push(matchByNearestY(names, lines));
  }

  return names.map((nameLine, rowIndex) => ({
    name: nameLine.text,
    byServing: qtyColumns.map((matched) => parseQuantityCell(matched[rowIndex]?.text ?? null)),
  }));
}

/** A flat bulleted "<qty> <unit> <name>" (or bare-name) list, one ingredient per line — the same shape the HelloFresh-website scraper already parses (ingredientParser.ts), so each line goes straight through its tokenizer with no column-alignment step needed. */
async function parseIngredientListLayout(
  page: { png: Buffer; width: number; height: number },
  region: Extract<IngredientsRegion, { layout: "list" }>,
  warnings: string[],
): Promise<ParsedCardIngredientRow[]> {
  const rows: ParsedCardIngredientRow[] = [];
  for (const columnRegion of region.columns) {
    const crop = await cropRegion(page.png, page.width, page.height, columnRegion);
    const lines = linesOf(await recognizeText(crop));
    for (const rawLine of lines) {
      if (INGREDIENT_LIST_END.test(rawLine) || NON_INGREDIENT_LINE.test(rawLine)) continue;
      const line = insertDigitUnitSpace(stripBulletNoise(rawLine));
      if (!line) continue;
      const parsed = parseIngredientLine(line);
      if (!parsed.name) continue;
      rows.push({
        name: parsed.name,
        byServing: [{ quantity: parsed.quantity, unit: parsed.unit, rawText: line }],
      });
    }
  }
  if (rows.length === 0) warnings.push("Couldn't read any ingredient rows.");
  return rows;
}

async function parseIngredients(
  page: { png: Buffer; width: number; height: number },
  region: IngredientsRegion,
  warnings: string[],
): Promise<ParsedCardIngredientRow[]> {
  return region.layout === "table"
    ? parseIngredientTableLayout(page, region, warnings)
    : parseIngredientListLayout(page, region, warnings);
}

/**
 * Re-examines the ingredient-name column's pixels (not just its OCR'd text)
 * for a HelloFresh "optional ingredient" callout, printed in red rather
 * than the card's normal near-black — see colorDetect.ts and e.g. Bacon
 * Leek and Mushroom Pie's optional chicken. Only applies to a "table"
 * ingredients layout (the one the known swap-block cards use); duplicates a
 * small crop+OCR call parseIngredientTableLayout already made internally,
 * traded for not threading OcrLine data back out through
 * ParsedCardIngredientRow just for this.
 */
async function flagRedHighlightedIngredients(
  page: { png: Buffer; width: number; height: number },
  region: IngredientsRegion,
  parsedRows: ParsedCardIngredientRow[],
  warnings: string[],
): Promise<void> {
  if (region.layout !== "table" || parsedRows.length === 0) return;
  const nameCrop = await cropRegion(page.png, page.width, page.height, region.nameColumn);
  const names = cleanIngredientNameLines(mergeWrappedNameLines(await recognizeLines(nameCrop)));
  for (const line of names) {
    if (await isReddishLine(nameCrop, line)) {
      warnings.push(
        `"${line.text}" looks highlighted in red on the card — likely an optional/swappable ingredient. Check whether to include it (and which nutrition column applies).`,
      );
    }
  }
}

// A real per-serving meal is never this low — well below any plausible
// reading, so a value under this is a truncated/misread digit (e.g. "504"
// clipped to "5") rather than a genuine (if surprising) figure. Left as a
// wrong-but-plausible "5" instead of null, this kind of miss is easy to
// skim past on the review screen; null makes it obviously unread instead.
const MIN_PLAUSIBLE_CALORIES = 50;

function parseEnergyKcal(value: string): number | null {
  // Card shows "kJ/kcal" as e.g. "3125/747" — kcal is the second number.
  // OCR doesn't reliably render the "/" itself (sometimes "[", sometimes a
  // plain space), so split on any run of digits rather than requiring it.
  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (numbers.length === 0) return null;
  const kcal = Math.round(numbers[numbers.length - 1]);
  return kcal >= MIN_PLAUSIBLE_CALORIES ? kcal : null;
}

function parseGramsCell(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? Number(match[1]) : null;
}

const NUTRIENT_FIELDS = [
  { key: "fatGrams", pattern: /^fat\b/i },
  { key: "saturatedFatGrams", pattern: /^sat/i },
  { key: "carbsGrams", pattern: /^carb/i },
  { key: "sugarGrams", pattern: /^sugar/i },
  { key: "proteinGrams", pattern: /^protein/i },
  // Older cards print "Sodium (g)" instead of "Salt (g)" for the same
  // figure — HelloFresh's own JSON-LD does the same thing site-side (see
  // the saltGrams comment on the Recipe model), so this app's convention is
  // already to treat that value as salt regardless of which word is used.
  { key: "saltGrams", pattern: /^(salt|sodium)/i },
  { key: "fiberGrams", pattern: /^fib(re|er)/i },
] as const;

/**
 * Drops a value column's unlabeled kJ row. Most layouts print one combined
 * "2487/504"-style cell for Energy that reads back as a single line, but at
 * least one (confirmed against a real scan of the single-serving template)
 * gives kJ its own full table row alongside the kcal row, sharing one
 * "Energy" label between the two rather than the label repeating — so it
 * OCRs as an extra, unlabeled value with no row of its own to pair against,
 * and left in place shifts every later row's pairing by one. A per-serving
 * reading this large can only be that kJ figure (real gram amounts, and
 * kcal itself, are always well under 1000), so it's simply discarded —
 * unlike the label side, there's no reliable way here to tell which of the
 * two rows is the "real" one to keep, so this doesn't try to rescue the
 * kcal figure from it, only to stop it from corrupting the rows after it.
 */
function dropUnlabeledEnergyRow(values: OcrLine[]): OcrLine[] {
  return values.filter((l) => {
    const numbers = [...l.text.matchAll(/\d+(?:\.\d+)?/g)];
    // A line with two or more numbers is a combined "2487/504"-style
    // kJ/kcal cell, not the lone extra row this is meant to catch —
    // parseEnergyKcal already knows how to pick the right one out of those.
    if (numbers.length > 1) return true;
    const lone = Number(numbers[0]?.[0] ?? NaN);
    return !(lone > 999);
  });
}

/** OCRs a value-column crop and keeps only lines that look like a real cell — every real row starts with a digit, which conveniently also drops a sliver of "Per serving" header text the crop often catches above the numeric rows. */
async function ocrNutritionValues(
  page: { png: Buffer; width: number; height: number },
  valueColumn: FractionalRegion,
): Promise<OcrLine[]> {
  const valueCrop = await cropRegion(page.png, page.width, page.height, valueColumn);
  const lines = (await recognizeLines(valueCrop)).filter((l) => /^\d/.test(l.text));
  return dropUnlabeledEnergyRow(lines);
}

// How much extra headroom to retry with when a value column's top row looks
// clipped (see readNutritionValueColumn) — a fraction of page height small
// enough to rescue a row sitting just inside the crop boundary without
// reaching far enough up to catch an unrelated line from the row above (on
// a real scan, consecutive nutrition rows sit roughly 0.017 apart).
const CLIPPED_ROW_RETRY_MARGIN = 0.008;

/** Reads one value column and pairs each row against already-OCR'd labels — split out from parseNutritionTable so a "Custom Recipe" swap block's second value column (see correctPage2Regions) can be read against the same label set without re-OCRing it. */
async function readNutritionValueColumn(
  page: { png: Buffer; width: number; height: number },
  labels: OcrLine[],
  valueColumn: FractionalRegion,
): Promise<NutritionFields> {
  let values = await ocrNutritionValues(page, valueColumn);
  // Fewer value rows than label rows is the signature of a clipped top row
  // (confirmed against a real scan: the energy figure sat a handful of
  // pixels inside the crop and didn't OCR at all, while the label crop's
  // "Energy" text — same top edge — read fine) rather than a genuinely
  // blank cell, which shows up as a *value* present but failing the
  // matchByNearestY distance instead. Only keep the retry's result if it
  // actually found more rows — otherwise the original crop was already
  // fine and widening it just risks pulling in a stray line from above.
  if (values.length < labels.length) {
    const grown = {
      ...valueColumn,
      top: Math.max(0, valueColumn.top - CLIPPED_ROW_RETRY_MARGIN),
      height: valueColumn.height + CLIPPED_ROW_RETRY_MARGIN,
    };
    const retried = await ocrNutritionValues(page, grown);
    if (retried.length > values.length) values = retried;
  }
  const matchedValues = matchByNearestY(labels, values);

  const result = emptyNutritionFields();
  labels.forEach((label, i) => {
    const value = matchedValues[i]?.text;
    if (!value) return;
    // Energy is always the table's first row on every known layout, and its
    // "(kJ/kcal)" suffix reads noticeably worse than the other rows' plain
    // "(g)" — seen against a real scan reading it as unrecognizable noise
    // ("CHRErgYy \KJ/KLdl)") while every other row read cleanly. Row 0 not
    // matching any other known nutrient is as good a signal as the text
    // itself that this was meant to be the energy row.
    const looksLikeEnergyRow = /^energy/i.test(label.text) || (i === 0 && !NUTRIENT_FIELDS.some((f) => f.pattern.test(label.text)));
    if (looksLikeEnergyRow) {
      result.calories = parseEnergyKcal(value);
      return;
    }
    const field = NUTRIENT_FIELDS.find((f) => f.pattern.test(label.text));
    if (field) result[field.key] = parseGramsCell(value);
  });
  return result;
}

async function parseNutritionTable(
  page: { png: Buffer; width: number; height: number },
  region: Extract<NutritionRegion, { layout: "table" }>,
  warnings: string[],
  swapBlockValueColumn?: FractionalRegion | null,
): Promise<{ base: NutritionFields; withOptionalIngredient: NutritionFields | null }> {
  const labelCrop = await cropRegion(page.png, page.width, page.height, region.labelColumn);
  // A real nutrient label always has a real word in it outside of its unit
  // ("Energy", "Fat (g)", ...) — fewer than 3 letters once any "(...)" unit
  // is stripped out is noise (a stray mark, a fragment of a neighbouring
  // column bleeding into the crop, or — confirmed against a real scan — a
  // "(kcal)" unit that OCR occasionally splits onto its own line, separate
  // from "Energy") rather than a genuine row. Left in, it consumes one of
  // the real value rows via matchByNearestY and cascade-misaligns every row
  // after it.
  const labels = (await recognizeLines(labelCrop)).filter(
    (l) => (l.text.replace(/\([^)]*\)/g, "").match(/[a-zA-Z]/g) ?? []).length >= 3,
  );

  const base = await readNutritionValueColumn(page, labels, region.valueColumn);
  if (base.calories == null) warnings.push("Couldn't read calories from the nutrition table.");

  let withOptionalIngredient: NutritionFields | null = null;
  if (swapBlockValueColumn) {
    withOptionalIngredient = await readNutritionValueColumn(page, labels, swapBlockValueColumn);
    warnings.push(
      "This card has an extra nutrition column, likely for a swappable/optional ingredient (see the ingredient warnings above) — both readings are shown below, double-check which applies.",
    );
  }

  return { base, withOptionalIngredient };
}

const LABELED_NUTRIENT_PATTERNS: { key: keyof NutritionFields; pattern: RegExp }[] = [
  { key: "calories", pattern: /calories:?\s*(\d+(?:\.\d+)?)/i },
  { key: "saturatedFatGrams", pattern: /saturated\s*fat:?\s*(\d+(?:\.\d+)?)/i },
  { key: "fatGrams", pattern: /(?<!saturated\s)\bfat:?\s*(\d+(?:\.\d+)?)/i },
  { key: "carbsGrams", pattern: /carb\w*:?\s*(\d+(?:\.\d+)?)/i },
  { key: "sugarGrams", pattern: /sugars?:?\s*(\d+(?:\.\d+)?)/i },
  { key: "proteinGrams", pattern: /protein:?\s*(\d+(?:\.\d+)?)/i },
  { key: "saltGrams", pattern: /(?:salt|sodium):?\s*(\d+(?:\.\d+)?)/i },
  { key: "fiberGrams", pattern: /fib(?:re|er):?\s*(\d+(?:\.\d+)?)/i },
];

/** "Calories: 741 kcal | Protein: 49 g | Carbs: 92 g | ..." — one line/block with labels and values already paired, so each field is just a direct regex search rather than needing separate label/value crops. */
async function parseNutritionLabeledText(
  page: { png: Buffer; width: number; height: number },
  region: Extract<NutritionRegion, { layout: "labeled-text" }>,
  warnings: string[],
): Promise<NutritionFields> {
  const crop = await cropRegion(page.png, page.width, page.height, region.block);
  const text = await recognizeText(crop);
  const result = emptyNutritionFields();
  for (const { key, pattern } of LABELED_NUTRIENT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) result[key] = key === "calories" ? Math.round(Number(match[1])) : Number(match[1]);
  }
  if (result.calories == null) warnings.push("Couldn't read calories from the nutrition line.");
  return result;
}

/** A single row of numbers with no attached labels (a header row above carries them instead) — read out by fixed column position, so `fields` must match the card's own column order exactly. */
async function parseNutritionPositional(
  page: { png: Buffer; width: number; height: number },
  region: Extract<NutritionRegion, { layout: "positional" }>,
  warnings: string[],
): Promise<NutritionFields> {
  const crop = await cropRegion(page.png, page.width, page.height, region.block);
  const text = await recognizeText(crop);
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

  const result = emptyNutritionFields();
  region.fields.forEach((field, i) => {
    const value = numbers[i];
    if (field && value != null) result[field] = field === "calories" ? Math.round(value) : value;
  });
  if (result.calories == null) warnings.push("Couldn't read calories from the nutrition table.");
  return result;
}

async function parseNutrition(
  page: { png: Buffer; width: number; height: number },
  region: NutritionRegion,
  warnings: string[],
  swapBlockValueColumn?: FractionalRegion | null,
): Promise<{ base: NutritionFields; withOptionalIngredient: NutritionFields | null }> {
  switch (region.layout) {
    case "table":
      return parseNutritionTable(page, region, warnings, swapBlockValueColumn);
    case "labeled-text":
      return { base: await parseNutritionLabeledText(page, region, warnings), withOptionalIngredient: null };
    case "positional":
      return { base: await parseNutritionPositional(page, region, warnings), withOptionalIngredient: null };
  }
}

function isAllCapsHeading(line: string): boolean {
  const letters = line.replace(/[^a-zA-Z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

async function parseStepsGrid(
  page: { png: Buffer; width: number; height: number },
  region: Extract<StepsRegion, { layout: "grid" }>,
  warnings: string[],
): Promise<ParsedCardStep[]> {
  const steps: ParsedCardStep[] = [];
  for (const [i, stepRegion] of region.steps.entries()) {
    const photo = stepRegion.photo
      ? await cropRegion(page.png, page.width, page.height, stepRegion.photo)
      : null;
    const textCrop = await cropRegion(page.png, page.width, page.height, stepRegion.text);
    const lines = linesOf(await recognizeText(textCrop));

    // A red-highlighted step (e.g. the extra chicken-cooking step on Bacon
    // Leek and Mushroom Pie's optional-ingredient card) needs line-level
    // bboxes recognizeText's flat string doesn't carry, hence the separate
    // recognizeLines call here on top of the recognizeText one above.
    const ocrLines = await recognizeLines(textCrop);
    for (const line of ocrLines) {
      if (await isReddishLine(textCrop, line)) {
        warnings.push(
          `Step ${i + 1} looks like it includes red-highlighted text (an optional/swappable-ingredient variant?) — check whether it applies to what you're cooking.`,
        );
        break;
      }
    }

    // Punctuation after the number is optional — some cards print "1.
    // Get Prepped", others just "1 PREP THE INGREDIENTS" with a bare space.
    const headingMatch = lines[0] && /^\d+[.)]?\s+(.+)$/.exec(lines[0]);
    // Other cards number each step with a large drop-cap numeral rendered as
    // its own graphic rather than text — OCR never sees a digit at all, just
    // the all-caps heading words that sit beside/below it (e.g. "PREP THE
    // INGREDIENTS"), distinguishable from the lowercase instruction prose
    // that follows.
    const capsHeading = !headingMatch && lines[0] && isAllCapsHeading(lines[0]) ? lines[0] : null;
    const heading = headingMatch ? headingMatch[1] : capsHeading;
    const text = (headingMatch || capsHeading ? lines.slice(1) : lines).join(" ");

    if (!text) warnings.push(`Step ${i + 1}: couldn't read any instruction text.`);
    steps.push({ heading, text, photo, textCrop });
  }
  return steps;
}

// Matches a *candidate* step boundary within a run of undifferentiated
// text: a 1-2 digit number (with or without a trailing period) at the very
// start of a line — e.g. "1 Slice the apple" or "6. Preheat the oven".
// Deliberately doesn't also require the following word to be capitalized —
// a large colored drop-cap numeral butting up against the next letter is a
// common OCR-misread source ("2 peeland" instead of "2 Peel and") — but
// that alone lets an ordinary number that happens to wrap onto its own
// line ("...for about 40\nminutes, or until...") false-positive as a step
// boundary. splitFlowingSteps filters candidates by whether their number
// plausibly continues the step sequence before trusting them.
const FLOWING_STEP_BOUNDARY = /(?:^|\n)\s*(\d{1,2})[.)]?\s+/g;

// How many consecutive step numbers can go completely unrecognized (OCR
// misread the numeral entirely, e.g. as "©") before the next real one still
// gets accepted. Wide enough to recover from a couple of bad reads, narrow
// enough that an unrelated number like "40" (from "40 minutes") — nowhere
// near the next expected step — still gets rejected.
const MAX_SKIPPED_STEP_NUMBERS = 3;

/** Mutable across calls so a step count can carry on from one column to the next (see parseStepsFlowing). */
interface StepSequence {
  lastAccepted: number;
}

function splitFlowingSteps(text: string, sequence: StepSequence): ParsedCardStep[] {
  const normalized = text.replace(/\r/g, "");
  const candidates = [...normalized.matchAll(FLOWING_STEP_BOUNDARY)];
  const accepted: { index: number; matchLength: number }[] = [];
  for (const m of candidates) {
    const n = Number(m[1]);
    if (n > sequence.lastAccepted && n <= sequence.lastAccepted + 1 + MAX_SKIPPED_STEP_NUMBERS) {
      accepted.push({ index: m.index ?? 0, matchLength: m[0].length });
      sequence.lastAccepted = n;
    }
  }

  if (accepted.length === 0) {
    const trimmed = normalized.replace(/\s+/g, " ").trim();
    return trimmed ? [{ heading: null, text: trimmed, photo: null, textCrop: null }] : [];
  }
  const steps: ParsedCardStep[] = [];
  for (let i = 0; i < accepted.length; i++) {
    const start = accepted[i].index + accepted[i].matchLength;
    const end = i + 1 < accepted.length ? accepted[i + 1].index : normalized.length;
    const stepText = normalized.slice(start, end).replace(/\s+/g, " ").trim();
    if (stepText) steps.push({ heading: null, text: stepText, photo: null, textCrop: null });
  }
  return steps;
}

/** Step text just runs down one or more columns with no fixed per-step height (a legacy layout — see regions.ts) — no photo matching is attempted here at all, since these cards' photos aren't 1:1 with steps or positioned anywhere near their own step's text. */
async function parseStepsFlowing(
  page: { png: Buffer; width: number; height: number },
  region: Extract<StepsRegion, { layout: "flowing" }>,
  warnings: string[],
): Promise<ParsedCardStep[]> {
  const steps: ParsedCardStep[] = [];
  const sequence: StepSequence = { lastAccepted: 0 };
  for (const columnRegion of region.columns) {
    const crop = await cropRegion(page.png, page.width, page.height, columnRegion);
    const text = await recognizeText(crop);
    steps.push(...splitFlowingSteps(text, sequence));
  }
  if (steps.length === 0) warnings.push("Couldn't read any step instructions.");
  return steps;
}

async function parseSteps(
  page: { png: Buffer; width: number; height: number },
  region: StepsRegion,
  warnings: string[],
): Promise<ParsedCardStep[]> {
  return region.layout === "grid"
    ? parseStepsGrid(page, region, warnings)
    : parseStepsFlowing(page, region, warnings);
}

/**
 * Tries each known template's title/time regions in turn and keeps the
 * first one that reads back a real-looking title with a time figure
 * nearby. Templates differ enough in geometry that a wrong guess wouldn't
 * just produce a slightly-off crop, it would read pure noise, so this check
 * is cheap (two small crops) before committing to the far more expensive
 * full parse against that template.
 */
async function detectTemplate(page1: {
  png: Buffer;
  width: number;
  height: number;
}): Promise<CardTemplate | null> {
  for (const template of CARD_TEMPLATES) {
    const titleCrop = await cropRegion(page1.png, page1.width, page1.height, template.page1.titleBlock);
    const timeCrop = await cropRegion(page1.png, page1.width, page1.height, template.page1.timeRegion);
    const { name } = parseTitleBlock(await recognizeText(titleCrop));
    const cookMinutes = parseTimeText(await recognizeText(timeCrop));
    if (name && name.split(/\s+/).length >= 2 && cookMinutes != null) {
      return template;
    }
  }
  return null;
}

/**
 * Corrects a template's page-2 ingredients/nutrition regions against where
 * their calibration anchors (see RegionAnchor in regions.ts) actually land
 * on this scan, via one shared full-page OCR pass — layout drift (a shifted
 * print run, or a card variant like the Bacon Pie "Custom Recipe" swap
 * block) moves both anchors and the content they label together, so a small
 * per-anchor offset keeps the fixed-fraction crops aligned without needing a
 * bespoke template per variant. Falls back to the template's own
 * uncorrected regions wherever a template defines no anchor for that
 * section, or the anchor's text isn't found on this particular scan.
 */
async function correctPage2Regions(
  page2: RasterPage,
  template: CardTemplate,
): Promise<{
  ingredients: IngredientsRegion;
  nutrition: NutritionRegion;
  nutritionSwapBlockValueColumn: FractionalRegion | null;
}> {
  const anchors = template.page2.anchors;
  if (!anchors) {
    return { ingredients: template.page2.ingredients, nutrition: template.page2.nutrition, nutritionSwapBlockValueColumn: null };
  }

  const lines = await recognizeLines(page2.png);

  let ingredients = template.page2.ingredients;
  if (anchors.ingredients) {
    const found = findAnchor(lines, anchors.ingredients.label, page2.width, page2.height, {
      left: anchors.ingredients.expectedLeft,
      top: anchors.ingredients.expectedTop,
    });
    if (found) {
      ingredients = shiftIngredientsRegion(
        ingredients,
        found.left - anchors.ingredients.expectedLeft,
        found.top - anchors.ingredients.expectedTop,
      );
    }
  }

  let nutrition = template.page2.nutrition;
  let nutritionSwapBlockValueColumn: FractionalRegion | null = null;
  if (anchors.nutrition) {
    const found = findAnchor(lines, anchors.nutrition.label, page2.width, page2.height, {
      left: anchors.nutrition.expectedLeft,
      top: anchors.nutrition.expectedTop,
    });
    const nutritionTop = found ? found.top : anchors.nutrition.expectedTop;
    if (found) {
      nutrition = shiftNutritionRegion(nutrition, found.left - anchors.nutrition.expectedLeft, found.top - anchors.nutrition.expectedTop);
    }

    // The section-title anchor only corrects for *vertical* drift reliably —
    // a swap block doesn't just shift the value column sideways, it
    // compresses two "Per serving / Per 100g" header pairs into roughly the
    // same width a plain card gives one, so a fixed horizontal offset from
    // the title can't locate it. Read the real column positions directly
    // off this scan's own header row instead (see findColumnHeaderPositions).
    if (nutrition.layout === "table") {
      const columnStarts = findColumnHeaderPositions(lines, nutritionTop, page2.width, page2.height);
      if (columnStarts.length >= 2) {
        // A swap block's 4 columns sit much closer together than the plain
        // layout's single value column the labelColumn's width was
        // calibrated against — left uncorrected, that width reaches past
        // the (now much closer) first value column and pulls its digits
        // into the label OCR pass too, scrambling the label/value row
        // pairing. Clamp it to stop just short of whatever column position
        // was actually detected.
        const labelColumn = {
          ...nutrition.labelColumn,
          width: Math.min(nutrition.labelColumn.width, Math.max(0.02, columnStarts[0] - nutrition.labelColumn.left - 0.005)),
        };
        nutrition = { ...nutrition, labelColumn, valueColumn: { ...nutrition.valueColumn, left: columnStarts[0] } };
        // 4 columns (not 2) is a base "Per serving/100g" pair plus a second
        // pair for a swap block's optional ingredient — see
        // findColumnHeaderPositions. columnStarts[2] is that second pair's
        // "Per serving" (not "Per 100g", which this app doesn't read at all).
        if (columnStarts.length >= 4) {
          nutritionSwapBlockValueColumn = { ...nutrition.valueColumn, left: columnStarts[2] };
        }
      }
    }
  }

  return { ingredients, nutrition, nutritionSwapBlockValueColumn };
}

/** Parses a scanned HelloFresh recipe-card PDF into structured (but unverified — always review before saving) recipe data. Only recognizes known card layouts (see regions.ts); anything else raises UnsupportedCardLayoutError. */
export async function parseCardPdf(pdfBytes: Uint8Array): Promise<ParsedCardRecipe> {
  const rawPages = await rasterizePdf(pdfBytes);
  if (rawPages.length < 2) {
    throw new UnsupportedCardLayoutError(`Expected a 2-page card PDF, got ${rawPages.length} page(s).`);
  }
  // Straighten each page before any template logic runs — a rotated scan
  // would otherwise throw off every fixed-fraction crop below by the same
  // amount a skewed anchor search is meant to catch on top of it. See
  // deskew.ts; a no-op (same page returned) for an already-upright scan.
  const [page1, page2] = await Promise.all([deskewPage(rawPages[0]), deskewPage(rawPages[1])]);

  const template = await detectTemplate(page1);
  if (!template) {
    throw new UnsupportedCardLayoutError(
      "This doesn't look like a supported HelloFresh card layout — try entering it manually instead.",
    );
  }

  const warnings: string[] = [];

  const titleCrop = await cropRegion(page1.png, page1.width, page1.height, template.page1.titleBlock);
  const { name, subtitle } = parseTitleBlock(await recognizeText(titleCrop));
  if (!name) warnings.push("Couldn't read the recipe title.");

  const timeCrop = await cropRegion(page1.png, page1.width, page1.height, template.page1.timeRegion);
  const cookMinutes = parseTimeText(await recognizeText(timeCrop));
  if (cookMinutes == null) warnings.push("Couldn't read the total cook time.");

  const coverPhoto = await cropRegion(page1.png, page1.width, page1.height, template.page1.coverPhoto);

  const {
    ingredients: ingredientsRegion,
    nutrition: nutritionRegion,
    nutritionSwapBlockValueColumn,
  } = await correctPage2Regions(page2, template);

  // Sequential, not Promise.all — OCR calls share a single Tesseract worker
  // (see ocr.ts) which isn't safe to run concurrently against; parallel
  // recognize() calls were observed to corrupt each other's results.
  const ingredients = await parseIngredients(page2, ingredientsRegion, warnings);
  await flagRedHighlightedIngredients(page2, ingredientsRegion, ingredients, warnings);
  const nutrition = await parseNutrition(page2, nutritionRegion, warnings, nutritionSwapBlockValueColumn);
  const steps = await parseSteps(page2, template.page2.steps, warnings);

  if (ingredients.length === 0) warnings.push("Couldn't read any ingredient rows.");

  // Not OCR — just a plain crop, so cheap enough to do unconditionally
  // rather than only when saveDraftImages is about to persist it. Lets the
  // review screen show "this is exactly what OCR read" next to the fields
  // it produced (see imageStorage.ts).
  const ingredientsCropRegion = unionRegion(
    ingredientsRegion.layout === "table"
      ? [ingredientsRegion.nameColumn, ...ingredientsRegion.qtyColumns]
      : ingredientsRegion.columns,
  );
  const ingredientsCrop = ingredientsCropRegion
    ? await cropRegion(page2.png, page2.width, page2.height, ingredientsCropRegion)
    : null;

  const nutritionCropRegion = unionRegion(
    [
      ...(nutritionRegion.layout === "table" ? [nutritionRegion.labelColumn, nutritionRegion.valueColumn] : [nutritionRegion.block]),
      ...(nutritionSwapBlockValueColumn ? [nutritionSwapBlockValueColumn] : []),
    ],
  );
  const nutritionCrop = nutritionCropRegion
    ? await cropRegion(page2.png, page2.width, page2.height, nutritionCropRegion)
    : null;

  return {
    templateId: template.id,
    name: name ?? "Untitled recipe",
    subtitle,
    cookMinutes,
    coverPhoto,
    ingredientsCrop,
    nutritionCrop,
    servingCounts: template.servingCounts,
    ingredients,
    steps,
    warnings,
    ...nutrition.base,
    nutritionWithOptionalIngredient: nutrition.withOptionalIngredient,
  };
}
