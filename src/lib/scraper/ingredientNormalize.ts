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
 * Intentionally still fairly simple (a curated alias table grows over time
 * as more real data is scraped) — this catches the common casing,
 * pluralization, and purpose-clause variance seen across HelloFresh recipes.
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

  n = stripTrailingPlural(n);

  return n;
}
