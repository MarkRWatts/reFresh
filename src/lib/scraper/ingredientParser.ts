import { normalizeUnitLabel } from "@/lib/ingredients/unitSynonyms";

export interface ParsedIngredientLine {
  quantity: number | null;
  unit: string | null;
  name: string;
  rawText: string;
}

// HelloFresh ingredient lines are inconsistently formatted across recipe
// eras: some carry an explicit unit ("1 unit(s) Garlic Clove", "450 grams
// Potatoes"), others just "<qty> <Name>" with no unit at all ("4 Chicken
// Thigh", "1 Onion"). Blindly treating the token after the quantity as the
// unit truncates names like "Chicken Thigh" down to "Thigh" — so a unit is
// only consumed when it's actually a known unit word.
const UNIT_WORDS = [
  "g",
  "grams",
  "gram",
  "kg",
  "kilograms",
  "ml",
  "millilitres",
  "milliliters",
  "l",
  "litre",
  "litres",
  "liter",
  "liters",
  "tbsp",
  "tbsps",
  "tablespoon",
  "tablespoons",
  "tsp",
  "tsps",
  "teaspoon",
  "teaspoons",
  "unit(s)",
  "units",
  "unit",
  "cup",
  "cups",
  "clove(s)",
  "cloves",
  "clove",
  "sachet(s)",
  "sachets",
  "sachet",
  "bunch(es)",
  "bunches",
  "bunch",
  "ball(s)",
  "balls",
  "ball",
  "pinch(es)",
  "pinches",
  "pinch",
  "pack(s)",
  "packs",
  "pack",
  "ounce(s)",
  "ounces",
  "ounce",
  "oz",
  "slice(s)",
  "slices",
  "slice",
  "piece(s)",
  "pieces",
  "piece",
  "block(s)",
  "blocks",
  "block",
  "fl oz",
  "carton(s)",
  "cartons",
  "carton",
  "milliliter(s)",
  "millilitre(s)",
  "pot(s)",
  "pots",
  "pot",
  "tin(s)",
  "tins",
  "tin",
  "jar(s)",
  "jars",
  "jar",
  "punnet(s)",
  "punnets",
  "punnet",
  "bottle(s)",
  "bottles",
  "bottle",
  "bag(s)",
  "bags",
  "bag",
  "handful(s)",
  "handfuls",
  "handful",
];
const UNIT_WORD_SET = new Set(UNIT_WORDS.map((u) => u.toLowerCase()));

// "unit(s)"/"units"/"unit" are HelloFresh's placeholder for "just a plain
// count, no real unit" (e.g. "1 unit(s) Garlic Clove") — recognized as a
// unit token so it's stripped out of the ingredient name correctly, but
// normalized to no unit rather than kept as the literal string "unit(s)".
// This also fixes a real shopping-list bug: without it, the same
// ingredient tracked as "unit(s)" in one recipe and genuinely unitless in
// another ("2 Eggs" vs "2 unit(s) Eggs") summed into two separate totals
// instead of being combined into one.
const PLACEHOLDER_UNIT_WORDS = new Set(["unit(s)", "units", "unit"]);

// Folds spelling variants (e.g. "grams"/"pot(s)"/"tablespoons") down to one
// canonical form at the source, so RecipeIngredient.unit is stored already
// normalized instead of needing normalizeUnitLabel() re-applied at every
// read site. Shares the same table those read sites use (unitSynonyms.ts)
// so parsing and reading can never drift out of sync with each other.
function normalizeUnit(unit: string | null): string | null {
  if (unit !== null && PLACEHOLDER_UNIT_WORDS.has(unit)) return null;
  return normalizeUnitLabel(unit);
}

// The full Unicode "Number Forms" set of vulgar fractions, not just the
// ones seen in scraped data so far — unlike a word-based heuristic, a
// fraction glyph is unambiguous (there's no "false positive" risk the way
// there was with origin qualifiers), so there's no reason to be
// conservative here. Originally missing the fifths/ninths/tenths, which
// caused lines like "⅕ Bunch(es) Rosemary" (common for herbs) to fail to
// parse entirely and dump the whole "⅕ bunch(es) rosemary" string into the
// ingredient name instead of splitting out quantity=0.2/unit=bunch(es).
const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅐": 1 / 7,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
  "⅑": 1 / 9,
  "⅒": 1 / 10,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

/** Parses a leading quantity token: plain numbers, simple fractions ("1/2"), unicode fractions ("½"), and mixed forms ("1½"). */
export function parseLeadingQuantity(token: string): number | null {
  const fractionMatch = /^(\d+)\/(\d+)$/.exec(token);
  if (fractionMatch) {
    return Number(fractionMatch[1]) / Number(fractionMatch[2]);
  }

  const mixedUnicodeMatch = new RegExp(`^(\\d+)?([${UNICODE_FRACTION_CHARS}])$`).exec(token);
  if (mixedUnicodeMatch) {
    const [, whole, fractionChar] = mixedUnicodeMatch;
    return Number(whole ?? 0) + UNICODE_FRACTIONS[fractionChar];
  }

  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  return null;
}

/**
 * Splits a HelloFresh recipeIngredient string into quantity/unit/name.
 * Only consumes a "unit" token when it's a recognized unit word — otherwise
 * everything after the quantity is treated as the ingredient name.
 */
/** Strips a leading unit word (no quantity present) from an otherwise-unmatched line, e.g. "unit(s) Turkey for 8-10p". */
function stripLeadingUnitOnly(text: string): ParsedIngredientLine {
  const match = /^(\S+)\s+(.+)$/.exec(text);
  if (match && UNIT_WORD_SET.has(match[1].toLowerCase())) {
    return {
      quantity: null,
      unit: normalizeUnit(match[1].toLowerCase()),
      name: match[2].trim(),
      rawText: text,
    };
  }
  return { quantity: null, unit: null, name: text, rawText: text };
}

export function parseIngredientLine(rawText: string): ParsedIngredientLine {
  const trimmed = rawText.trim();
  const quantityMatch = new RegExp(
    `^(\\d+(?:\\.\\d+)?(?:\\/\\d+)?|\\d*[${UNICODE_FRACTION_CHARS}])\\s+(.+)$`,
  ).exec(trimmed);

  if (!quantityMatch) {
    return stripLeadingUnitOnly(trimmed);
  }

  const [, quantityToken, remainder] = quantityMatch;
  const quantity = parseLeadingQuantity(quantityToken);
  if (quantity === null) {
    return stripLeadingUnitOnly(trimmed);
  }

  // "fl oz" is the one two-word unit; check it before falling back to a
  // single-word check.
  const twoWordMatch = /^(\S+\s+\S+)\s+(.+)$/.exec(remainder);
  if (twoWordMatch && UNIT_WORD_SET.has(twoWordMatch[1].toLowerCase())) {
    return {
      quantity,
      unit: normalizeUnit(twoWordMatch[1].toLowerCase()),
      name: twoWordMatch[2].trim(),
      rawText: trimmed,
    };
  }

  const oneWordMatch = /^(\S+)\s+(.+)$/.exec(remainder);
  if (oneWordMatch && UNIT_WORD_SET.has(oneWordMatch[1].toLowerCase())) {
    return {
      quantity,
      unit: normalizeUnit(oneWordMatch[1].toLowerCase()),
      name: oneWordMatch[2].trim(),
      rawText: trimmed,
    };
  }

  return { quantity, unit: null, name: remainder.trim(), rawText: trimmed };
}
