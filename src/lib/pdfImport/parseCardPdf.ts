import { splitNameAndSubtitle } from "@/lib/scraper/fieldParsers";
import { parseIngredientLine } from "@/lib/scraper/ingredientParser";
import { recognizeText, recognizeLines, type OcrLine } from "./ocr";
import { rasterizePdf } from "./rasterize";
import {
  cropRegion,
  CARD_TEMPLATES,
  type CardTemplate,
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
}

export interface ParsedCardRecipe {
  templateId: string;
  name: string;
  subtitle: string | null;
  cookMinutes: number | null;
  coverPhoto: Buffer;
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
  steps: ParsedCardStep[];
  /** Fields that came back empty/ambiguous — surfaced on the review screen rather than silently dropped. */
  warnings: string[];
}

type NutritionFields = Pick<
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
export type DraftRecipeData = Omit<ParsedCardRecipe, "coverPhoto" | "steps"> & {
  steps: Array<Omit<ParsedCardStep, "photo">>;
};

export function toDraftRecipeData(parsed: ParsedCardRecipe): DraftRecipeData {
  const { coverPhoto: _coverPhoto, steps, ...rest } = parsed;
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
      merged[merged.length - 1] = { text: `${prev.text} ${line.text}`.trim(), y: prev.y };
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

function parseQuantityCell(cellText: string | null): ParsedCardQuantity {
  if (!cellText) return { quantity: null, unit: null, rawText: "" };
  const { quantity, unit } = parseIngredientLine(`${insertDigitUnitSpace(cellText)} placeholder`);
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

function parseEnergyKcal(value: string): number | null {
  // Card shows "kJ/kcal" as e.g. "3125/747" — kcal is the second number.
  // OCR doesn't reliably render the "/" itself (sometimes "[", sometimes a
  // plain space), so split on any run of digits rather than requiring it.
  const numbers = [...value.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (numbers.length === 0) return null;
  return Math.round(numbers[numbers.length - 1]);
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

async function parseNutritionTable(
  page: { png: Buffer; width: number; height: number },
  region: Extract<NutritionRegion, { layout: "table" }>,
  warnings: string[],
): Promise<NutritionFields> {
  const labelCrop = await cropRegion(page.png, page.width, page.height, region.labelColumn);
  const valueCrop = await cropRegion(page.png, page.width, page.height, region.valueColumn);
  const labels = await recognizeLines(labelCrop);
  // The value column sits directly under the "Per serving" header, so its
  // crop often catches a sliver of that header text above the real numeric
  // rows (e.g. "or serving") — every real row starts with a digit, so
  // filtering on that drops the header fragment regardless of exactly
  // where the crop's top edge falls.
  const values = (await recognizeLines(valueCrop)).filter((l) => /^\d/.test(l.text));
  const matchedValues = matchByNearestY(labels, values);

  const result = emptyNutritionFields();
  labels.forEach((label, i) => {
    const value = matchedValues[i]?.text;
    if (!value) return;
    if (/^energy/i.test(label.text)) {
      result.calories = parseEnergyKcal(value);
      return;
    }
    const field = NUTRIENT_FIELDS.find((f) => f.pattern.test(label.text));
    if (field) result[field.key] = parseGramsCell(value);
  });

  if (result.calories == null) warnings.push("Couldn't read calories from the nutrition table.");
  return result;
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
): Promise<NutritionFields> {
  switch (region.layout) {
    case "table":
      return parseNutritionTable(page, region, warnings);
    case "labeled-text":
      return parseNutritionLabeledText(page, region, warnings);
    case "positional":
      return parseNutritionPositional(page, region, warnings);
  }
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

    const headingMatch = lines[0] && /^\d+[.)]\s*(.+)$/.exec(lines[0]);
    const heading = headingMatch ? headingMatch[1] : null;
    const text = (headingMatch ? lines.slice(1) : lines).join(" ");

    if (!text) warnings.push(`Step ${i + 1}: couldn't read any instruction text.`);
    steps.push({ heading, text, photo });
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
    return trimmed ? [{ heading: null, text: trimmed, photo: null }] : [];
  }
  const steps: ParsedCardStep[] = [];
  for (let i = 0; i < accepted.length; i++) {
    const start = accepted[i].index + accepted[i].matchLength;
    const end = i + 1 < accepted.length ? accepted[i + 1].index : normalized.length;
    const stepText = normalized.slice(start, end).replace(/\s+/g, " ").trim();
    if (stepText) steps.push({ heading: null, text: stepText, photo: null });
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

/** Parses a scanned HelloFresh recipe-card PDF into structured (but unverified — always review before saving) recipe data. Only recognizes known card layouts (see regions.ts); anything else raises UnsupportedCardLayoutError. */
export async function parseCardPdf(pdfBytes: Uint8Array): Promise<ParsedCardRecipe> {
  const pages = await rasterizePdf(pdfBytes);
  if (pages.length < 2) {
    throw new UnsupportedCardLayoutError(`Expected a 2-page card PDF, got ${pages.length} page(s).`);
  }
  const [page1, page2] = pages;

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

  // Sequential, not Promise.all — OCR calls share a single Tesseract worker
  // (see ocr.ts) which isn't safe to run concurrently against; parallel
  // recognize() calls were observed to corrupt each other's results.
  const ingredients = await parseIngredients(page2, template.page2.ingredients, warnings);
  const nutrition = await parseNutrition(page2, template.page2.nutrition, warnings);
  const steps = await parseSteps(page2, template.page2.steps, warnings);

  if (ingredients.length === 0) warnings.push("Couldn't read any ingredient rows.");

  return {
    templateId: template.id,
    name: name ?? "Untitled recipe",
    subtitle,
    cookMinutes,
    coverPhoto,
    servingCounts: template.servingCounts,
    ingredients,
    steps,
    warnings,
    ...nutrition,
  };
}
