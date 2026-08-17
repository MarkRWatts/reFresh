import sharp from "sharp";

/** A bounding box expressed as a fraction (0–1) of the page's width/height, so one template works across scans at slightly different resolutions — it does not correct for skew or an off-center scan. */
export interface FractionalRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridStepRegion {
  /** Null when this specific step has no photo on the card (some older layouts only photograph a handful of steps) — see parseCardPdf.ts's parseSteps. */
  photo: FractionalRegion | null;
  text: FractionalRegion;
}

/** How the ingredient list is laid out. "table": a name column plus one quantity column per serving size, read and row-matched separately (see parseIngredientTable in parseCardPdf.ts) — needed because OCR-ing a multi-column table as one blob loses column alignment. "list": one or more flat columns where each line is already "<qty> <unit> <name>" or a bare name, read straight into the same tokenizer the HelloFresh-website scraper uses (ingredientParser.ts) — no column alignment problem to solve since there's only one column of text. */
export type IngredientsRegion =
  | { layout: "table"; nameColumn: FractionalRegion; qtyColumns: FractionalRegion[] }
  | { layout: "list"; columns: FractionalRegion[] };

/** How the nutrition figures are laid out. "table": label column + value column, read and row-matched separately, same reasoning as the ingredient table. "labeled-text": labels and values sit together in one blob (e.g. "Calories: 741 kcal | Protein: 49 g"), so a single crop can be regex-scanned for "<label>: <number>" per nutrient. "positional": numbers appear with no labels attached to them at all (a header row above them carries the labels instead) — the crop is scanned for a value in each field's fixed position, so the field order below must exactly match the card's own column order. */
export type NutritionRegion =
  | { layout: "table"; labelColumn: FractionalRegion; valueColumn: FractionalRegion }
  | { layout: "labeled-text"; block: FractionalRegion }
  | { layout: "positional"; block: FractionalRegion; fields: PositionalNutrientField[] };

export type PositionalNutrientField =
  | "calories"
  | "fatGrams"
  | "saturatedFatGrams"
  | "carbsGrams"
  | "sugarGrams"
  | "proteinGrams"
  | "saltGrams"
  | "fiberGrams"
  | null; // a column present on the card that this app has no field for — its number is skipped

/** How recipe steps are laid out. "grid": a fixed photo+text region per step, in reading order — the modern cards' uniform layout. "flowing": step text just runs down one or more columns with no fixed per-step height (a legacy layout, where photos also aren't 1:1 with steps and can't be matched automatically) — text is split into steps by finding each "N." marker, and no photos are extracted for these. */
export type StepsRegion =
  | { layout: "grid"; steps: GridStepRegion[] }
  | { layout: "flowing"; columns: FractionalRegion[] };

/**
 * Named crop regions for one HelloFresh card layout generation. Calibrated
 * by eye against a rendered sample of that layout (see scripts/import-pdf.ts
 * --dump-crops) — expect to need retuning if a card's print layout shifts.
 */
export interface CardTemplate {
  id: string;
  /** The serving size each ingredient-quantity column represents, e.g. [2, 3, 4] for a 2P/3P/4P table, or [2] for a single fixed-serving column/list. Fixed per template rather than read off the card, since it's part of what defines the template's shape. */
  servingCounts: number[];
  page1: {
    /** Name + subtitle only — not every layout keeps the time/tag line next to the title (see timeRegion). */
    titleBlock: FractionalRegion;
    /** Wherever the total-time text lives, whether that's part of the title block's area or a separate icon strip elsewhere on the page. */
    timeRegion: FractionalRegion;
    coverPhoto: FractionalRegion;
  };
  page2: {
    ingredients: IngredientsRegion;
    nutrition: NutritionRegion;
    steps: StepsRegion;
  };
}

/**
 * The modern 3-serving-column layout (2P/3P/4P), seen on cards like
 * "Teriyaki Beef Mince" and "Bacon Leek and Mushroom Pie".
 */
export const HF_SCALING_TABLE_TEMPLATE: CardTemplate = {
  id: "hf-scaling-table",
  servingCounts: [2, 3, 4],
  page1: {
    titleBlock: { left: 0.1, top: 0.03, width: 0.6, height: 0.1 },
    timeRegion: { left: 0.1, top: 0.13, width: 0.6, height: 0.05 },
    coverPhoto: { left: 0, top: 0.18, width: 0.83, height: 0.8 },
  },
  page2: {
    ingredients: {
      layout: "table",
      nameColumn: { left: 0, top: 0.171, width: 0.083, height: 0.283 },
      qtyColumns: [
        { left: 0.083, top: 0.171, width: 0.045, height: 0.283 },
        { left: 0.128, top: 0.171, width: 0.047, height: 0.283 },
        { left: 0.175, top: 0.171, width: 0.065, height: 0.283 },
      ],
    },
    // Calibrated against the plain 2-column nutrition table (Teriyaki). A
    // "Custom Recipe" swap block (see Bacon Pie) adds extra Per-serving/
    // Per-100g columns that squeeze into a different position — attempted
    // to widen this to cover both and it made both worse, so this stays
    // tuned to the more common plain layout; the swap-block variant's
    // nutrition numbers are a known gap, left for the review screen.
    nutrition: {
      layout: "table",
      labelColumn: { left: 0, top: 0.5, width: 0.1, height: 0.15 },
      valueColumn: { left: 0.115, top: 0.5, width: 0.05, height: 0.15 },
    },
    steps: {
      layout: "grid",
      steps: [
        { photo: { left: 0.24, top: 0.01, width: 0.2533, height: 0.19 }, text: { left: 0.24, top: 0.21, width: 0.2533, height: 0.13 } },
        { photo: { left: 0.4933, top: 0.01, width: 0.2533, height: 0.19 }, text: { left: 0.4933, top: 0.21, width: 0.2533, height: 0.13 } },
        { photo: { left: 0.7467, top: 0.01, width: 0.2533, height: 0.19 }, text: { left: 0.7467, top: 0.21, width: 0.2533, height: 0.13 } },
        { photo: { left: 0.24, top: 0.48, width: 0.2533, height: 0.185 }, text: { left: 0.24, top: 0.665, width: 0.2533, height: 0.2 } },
        { photo: { left: 0.4933, top: 0.48, width: 0.2533, height: 0.185 }, text: { left: 0.4933, top: 0.665, width: 0.2533, height: 0.2 } },
        { photo: { left: 0.7467, top: 0.48, width: 0.2533, height: 0.185 }, text: { left: 0.7467, top: 0.665, width: 0.2533, height: 0.2 } },
      ],
    },
  },
};

/**
 * An older single-serving-count layout, seen on "Steak Tagliata" — not just
 * a 1-column variant of the scaling-table template, but a mirrored page:
 * the recipe steps occupy the left ~86% of page 2 in a 3x2 grid, and the
 * ingredients/nutrition/allergens live in a narrow column on the right,
 * roughly the opposite of where they sit in HF_SCALING_TABLE_TEMPLATE. The
 * time/tag line also isn't part of the title block here — it's a separate
 * icon strip along the bottom-left of page 1.
 */
export const HF_SINGLE_SERVING_TEMPLATE: CardTemplate = {
  id: "hf-single-serving",
  servingCounts: [2],
  page1: {
    titleBlock: { left: 0.16, top: 0.03, width: 0.45, height: 0.1 },
    timeRegion: { left: 0, top: 0.857, width: 1, height: 0.11 },
    coverPhoto: { left: 0, top: 0.135, width: 0.9, height: 0.72 },
  },
  page2: {
    ingredients: {
      layout: "table",
      nameColumn: { left: 0.752, top: 0.092, width: 0.162, height: 0.204 },
      qtyColumns: [{ left: 0.914, top: 0.092, width: 0.071, height: 0.204 }],
    },
    nutrition: {
      layout: "table",
      labelColumn: { left: 0.752, top: 0.341, width: 0.1, height: 0.133 },
      valueColumn: { left: 0.855, top: 0.341, width: 0.045, height: 0.133 },
    },
    steps: {
      layout: "grid",
      steps: [
        { photo: { left: 0, top: 0.023, width: 0.2867, height: 0.22 }, text: { left: 0, top: 0.25, width: 0.2867, height: 0.22 } },
        { photo: { left: 0.2867, top: 0.023, width: 0.2867, height: 0.22 }, text: { left: 0.2867, top: 0.25, width: 0.2867, height: 0.22 } },
        { photo: { left: 0.5733, top: 0.023, width: 0.2867, height: 0.22 }, text: { left: 0.5733, top: 0.25, width: 0.2867, height: 0.22 } },
        { photo: { left: 0, top: 0.535, width: 0.2867, height: 0.226 }, text: { left: 0, top: 0.767, width: 0.2867, height: 0.23 } },
        { photo: { left: 0.2867, top: 0.535, width: 0.2867, height: 0.226 }, text: { left: 0.2867, top: 0.767, width: 0.2867, height: 0.23 } },
        { photo: { left: 0.5733, top: 0.535, width: 0.2867, height: 0.226 }, text: { left: 0.5733, top: 0.767, width: 0.2867, height: 0.23 } },
      ],
    },
  },
};

/**
 * A legacy portrait layout ("Trisha's Apple and Pork Tortillas") — a much
 * older print design than the two above (round logo badge, author-credited
 * blog-style intro, single flat time badge). Its ingredient table is close
 * enough to HF_SINGLE_SERVING_TEMPLATE's to reuse "table", but nutrition is
 * one plain "Label: value | Label: value" line rather than a table, and
 * steps run down two text columns with no fixed height per step — photos
 * only exist for some steps and aren't attempted here (see StepsRegion).
 */
export const HF_LEGACY_PORTRAIT_TEMPLATE: CardTemplate = {
  id: "hf-legacy-portrait",
  servingCounts: [2],
  page1: {
    titleBlock: { left: 0.02, top: 0.603, width: 0.95, height: 0.03 },
    timeRegion: { left: 0.66, top: 0.66, width: 0.3, height: 0.03 },
    coverPhoto: { left: 0, top: 0, width: 1, height: 0.58 },
  },
  page2: {
    ingredients: {
      layout: "table",
      nameColumn: { left: 0.02, top: 0.03, width: 0.22, height: 0.135 },
      qtyColumns: [{ left: 0.28, top: 0.03, width: 0.09, height: 0.135 }],
    },
    nutrition: { layout: "labeled-text", block: { left: 0, top: 0.24, width: 1, height: 0.025 } },
    steps: {
      layout: "flowing",
      columns: [
        { left: 0.27, top: 0.29, width: 0.335, height: 0.68 },
        { left: 0.62, top: 0.29, width: 0.335, height: 0.68 },
      ],
    },
  },
};

/**
 * A HelloFresh x Jamie Oliver partner-branded card. Ingredients are a plain
 * bulleted "<qty> <name>" list across two columns (no table at all), and
 * nutrition is a single-row table with no per-row labels (a header row
 * carries them instead, so values are read out positionally — see
 * NutritionRegion). Steps flow the same way as HF_LEGACY_PORTRAIT_TEMPLATE.
 */
export const HF_PARTNER_CARD_TEMPLATE: CardTemplate = {
  id: "hf-partner-card",
  servingCounts: [2],
  page1: {
    titleBlock: { left: 0.017, top: 0.562, width: 0.583, height: 0.08 },
    timeRegion: { left: 0.65, top: 0.66, width: 0.35, height: 0.06 },
    coverPhoto: { left: 0, top: 0, width: 1, height: 0.55 },
  },
  page2: {
    ingredients: {
      layout: "list",
      columns: [
        { left: 0.02, top: 0.032, width: 0.37, height: 0.14 },
        { left: 0.385, top: 0.032, width: 0.335, height: 0.14 },
      ],
    },
    nutrition: {
      layout: "positional",
      block: { left: 0, top: 0.2, width: 0.72, height: 0.06 },
      fields: ["calories", "fatGrams", "saturatedFatGrams", "proteinGrams", "carbsGrams", "sugarGrams", "saltGrams", "fiberGrams"],
    },
    steps: {
      layout: "flowing",
      columns: [
        { left: 0.27, top: 0.32, width: 0.335, height: 0.6 },
        { left: 0.62, top: 0.32, width: 0.335, height: 0.45 },
      ],
    },
  },
};

export const CARD_TEMPLATES: CardTemplate[] = [
  HF_SCALING_TABLE_TEMPLATE,
  HF_SINGLE_SERVING_TEMPLATE,
  HF_LEGACY_PORTRAIT_TEMPLATE,
  HF_PARTNER_CARD_TEMPLATE,
];

/** Crops a fractional region out of a rasterized page (see rasterize.ts) into its own PNG buffer, ready for OCR or storage. */
export async function cropRegion(
  pageBuffer: Buffer,
  pageWidth: number,
  pageHeight: number,
  region: FractionalRegion,
): Promise<Buffer> {
  const left = Math.min(pageWidth - 1, Math.round(region.left * pageWidth));
  const top = Math.min(pageHeight - 1, Math.round(region.top * pageHeight));
  // Rounding left/width independently can land 1px past the edge for a
  // region defined right up against it (e.g. left: 0.65, width: 0.35, on
  // some page widths) — clamp rather than let sharp reject the whole crop.
  const width = Math.max(1, Math.min(pageWidth - left, Math.round(region.width * pageWidth)));
  const height = Math.max(1, Math.min(pageHeight - top, Math.round(region.height * pageHeight)));
  return sharp(pageBuffer).extract({ left, top, width, height }).png().toBuffer();
}
