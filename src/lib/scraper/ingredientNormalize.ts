/**
 * Canonicalizes an ingredient name for cross-recipe matching, e.g.
 * "Garlic Cloves" / "Garlic Clove" / "garlic clove" -> "garlic clove".
 * Intentionally naive (Phase 2 in the project plan formalizes this further
 * with a curated alias table) — this just needs to catch the common casing
 * and pluralization variance seen across HelloFresh recipes.
 */
export function canonicalizeIngredientName(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/[®™]/g, "");
  n = n.replace(/\s+/g, " ");
  n = n.replace(/[.,]+$/, "");

  if (n.endsWith("ies") && n.length > 5) {
    n = `${n.slice(0, -3)}y`;
  } else if (n.endsWith("oes") && n.length > 5) {
    n = n.slice(0, -2);
  } else if (n.endsWith("s") && !n.endsWith("ss") && n.length > 4) {
    n = n.slice(0, -1);
  }

  return n;
}
