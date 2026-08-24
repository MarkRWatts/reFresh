// Words that are invariant (or already singular) despite ending in "s" —
// naive pluralization stripping would otherwise mangle these into
// non-words ("couscous" -> "couscou", "asparagus" -> "asparagu").
const INVARIANT_WORDS_ENDING_IN_S = new Set([
  "houmous",
  "hummus",
  "couscous",
  "asparagus",
  "molasses",
  "brussels",
  "manis",
]);

// Leading qualifiers that describe provenance/welfare standard rather than
// a different purchasable product — "British Chicken Breast" and "Chicken
// Breast" are the same shopping-list item, just scraped from recipes that
// did/didn't bother naming the origin. Longest phrases first, so "free
// range" matches before a hypothetical bare "free" would.
//
// Deliberately narrow and only added after checking each word against the
// actual scraped catalog for false positives — "English" looked like the
// same kind of qualifier but isn't: "English Mustard" is a genuinely
// different product from plain "Mustard" (a specific hot condiment, not a
// provenance label), so it's excluded despite the superficial pattern
// match.
//
// Deliberately does NOT include prep-state words ("diced", "minced",
// "sliced", "chopped", ...) even though they superficially look like the
// same kind of qualifier. Confirmed during a data-cleanup pass: a prep
// word can name a genuinely different purchasable product, not just
// describe the same one differently — e.g. "diced chicken breast" is
// bought/measured by weight (you dice to hit a gram target) while whole
// "chicken breast" is often bought/measured per-person-count (one whole
// breast per portion), and merging them loses that distinction. If you're
// tempted to add a prep word here, validate it against real scraped data
// the same way "British"/"free-range" were validated, not by
// pattern-matching against this list's existing entries.
const ORIGIN_QUALIFIER_PREFIXES = [
  "rspca assured",
  "free-range",
  "free range",
  "outdoor-bred",
  "outdoor bred",
  "british",
];

function stripOriginQualifiers(n: string): string {
  let result = n;
  let strippedSomething = true;
  while (strippedSomething) {
    strippedSomething = false;
    for (const prefix of ORIGIN_QUALIFIER_PREFIXES) {
      if (result.startsWith(`${prefix} `)) {
        result = result.slice(prefix.length + 1);
        strippedSomething = true;
        break;
      }
    }
  }
  return result;
}

function stripTrailingPlural(n: string): string {
  const words = n.split(" ");
  const lastWord = words[words.length - 1];
  if (INVARIANT_WORDS_ENDING_IN_S.has(lastWord)) return n;

  if (n.endsWith("ies") && n.length > 5) {
    return `${n.slice(0, -3)}y`;
  }
  if (n.endsWith("oes") && n.length > 5) {
    return n.slice(0, -2);
  }
  if (n.endsWith("s") && !n.endsWith("ss") && n.length > 4) {
    return n.slice(0, -1);
  }
  return n;
}

/**
 * Canonicalizes an ingredient name for cross-recipe matching, e.g.
 * "Garlic Cloves" / "Garlic Clove" / "garlic clove" -> "garlic clove".
 *
 * HelloFresh ingredient text often carries a purpose clause naming which
 * part of the recipe it's for — "Water for the Sauce", "Olive Oil for the
 * Dressing", "Water for the Rice" — which, left alone, fragments a single
 * pantry staple into dozens of distinct "ingredients" and defeats the
 * whole point of finding shared ingredients across recipes. That clause is
 * stripped before canonicalizing.
 *
 * Also strips leading origin/welfare-standard qualifiers ("British",
 * "Free-Range", ...) that don't change the actual product — see
 * ORIGIN_QUALIFIER_PREFIXES.
 *
 * Intentionally still fairly simple (a curated alias table grows over time
 * as more real data is scraped) — this catches the common casing,
 * pluralization, purpose-clause, and origin-qualifier variance seen across
 * HelloFresh recipes.
 */
export function canonicalizeIngredientName(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/[®™]/g, "");
  n = n.replace(/\s+/g, " ");
  n = n.replace(/[.,]+$/, "");
  n = n.replace(/\s+for\s+.+$/, "").trim();

  // "boiled"/"boiling" are prep-instructions on water in this dataset, not
  // a distinct purchasable ingredient.
  if (n === "boiled water" || n === "boiling water") n = "water";

  n = stripOriginQualifiers(n);
  n = stripTrailingPlural(n);

  return n;
}
