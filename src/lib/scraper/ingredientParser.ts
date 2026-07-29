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

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

/** Parses a leading quantity token: plain numbers, simple fractions ("1/2"), unicode fractions ("½"), and mixed forms ("1½"). */
function parseLeadingQuantity(token: string): number | null {
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
    return { quantity: null, unit: match[1].toLowerCase(), name: match[2].trim(), rawText: text };
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
    return { quantity, unit: twoWordMatch[1].toLowerCase(), name: twoWordMatch[2].trim(), rawText: trimmed };
  }

  const oneWordMatch = /^(\S+)\s+(.+)$/.exec(remainder);
  if (oneWordMatch && UNIT_WORD_SET.has(oneWordMatch[1].toLowerCase())) {
    return { quantity, unit: oneWordMatch[1].toLowerCase(), name: oneWordMatch[2].trim(), rawText: trimmed };
  }

  return { quantity, unit: null, name: remainder.trim(), rawText: trimmed };
}
