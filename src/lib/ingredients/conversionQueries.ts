import { prisma } from "@/lib/db";
import { normalizeUnitLabel } from "./unitSynonyms";

export type ConversionMatchType =
  | "already-base"
  | "missing-unit"
  | "missing-unit-ambiguous"
  | "density-assumed"
  | "packaged-unit-mention"
  | "other-unit"
  | "no-quantity";

export interface ConversionCandidateRow {
  recipeIngredientId: string;
  recipeId: string;
  recipeSlug: string;
  recipeName: string;
  quantity: number | null;
  unit: string | null;
  matchType: ConversionMatchType;
  /** The quantity/unit this row would become if applied — always set except for "already-base"/"other-unit"/"no-quantity", where there's nothing to apply. For "missing-unit-ambiguous" this is the "already in the base unit" reading — see alternateQuantity for the other one. */
  suggestedQuantity: number | null;
  suggestedUnit: string | null;
  /** Only set for "missing-unit-ambiguous" — the OTHER plausible reading: this bare number as a count of the packaged unit itself (e.g. "0.75" meaning "¾ pot"), multiplied out to the same base unit as suggestedQuantity. Two numbers because a small bare number genuinely could be either — see the classification doc comment. */
  alternateQuantity: number | null;
  /** True when the suggestion required treating grams and millilitres as equivalent (1g ≈ 1ml) — a reasonable approximation for a dairy/liquid-ish product, but a real assumption, not a unit conversion. Never computed silently without being flagged. */
  assumedDensity: boolean;
}

export interface IngredientConversionReview {
  ingredient: {
    id: string;
    canonicalName: string;
    packagedUnit: string;
    packagedUnitQuantity: number;
    packagedUnitBase: string;
  };
  rows: ConversionCandidateRow[];
}

/**
 * For one ingredient with a researched packaged-unit size (e.g. "1 pot(s)
 * of creme fraiche = 150ml" — see the ingredient review page), lists every
 * recipe that uses it and classifies its current quantity/unit against
 * the ingredient's base measure (packagedUnitBase — the unit you'd
 * actually buy it in, e.g. ml for a pourable dairy product):
 *
 * - already-base: unit already matches — nothing to do.
 * - missing-unit: no unit recorded at all (HelloFresh's own text often
 *   just says e.g. "150 Creme Fraiche") — for this kind of ingredient a
 *   bare number IS the base unit, just missing its label, so the fix is
 *   filling in the label, not touching the number. Only for numbers large
 *   enough that this reading is actually plausible — see
 *   missing-unit-ambiguous for the rest.
 * - missing-unit-ambiguous: also a bare number, but small enough
 *   (< 10% of one packaged unit) that it's genuinely unclear whether it
 *   means "already in the base unit" or "a count of the packaged unit
 *   itself" — e.g. a bare "0.75" for creme fraiche is a nonsensical
 *   0.75ml but a completely normal "¾ pot" (112.5ml). Found by checking
 *   real data before trusting this bulk-eligible, not by assumption —
 *   both readings are surfaced (see alternateQuantity) and neither is
 *   suggested by default; this is deliberately excluded from the bulk
 *   "fill in / relabel" action.
 * - density-assumed: recorded in the "other" of grams/millilitres — a
 *   straight relabel, correct assuming ~1g ≈ 1ml (flagged, not asserted).
 * - packaged-unit-mention: recorded directly in the packaged unit itself
 *   (e.g. "1 pot") — converted to the base measure by multiplying out
 *   (1 pot -> 150ml), since a recipe should store a precise, scalable
 *   amount rather than a purchase-size count. This is also the direction
 *   computeSharedIngredients (sharedIngredients.ts) already treats as
 *   canonical for shopping-list summing — recipes stored this way don't
 *   need that on-the-fly conversion at all.
 * - other-unit: a genuinely unrelated unit (tbsp, etc.) this tool doesn't
 *   attempt to relate.
 * - no-quantity: nothing recorded to convert.
 *
 * Returns null if the ingredient doesn't have a complete packaged-unit
 * definition yet. Never applies anything itself — see actions.ts's
 * applyPackagedUnitConversion (per-row) and rebaseIngredientToPackagedBase
 * / convertPackagedUnitMentionsToBase (bulk), all human-triggered.
 */
export async function getIngredientConversionReview(
  ingredientId: string,
): Promise<IngredientConversionReview | null> {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient?.packagedUnit || ingredient.packagedUnitQuantity == null || !ingredient.packagedUnitBase) {
    return null;
  }
  const { packagedUnit, packagedUnitQuantity, packagedUnitBase } = ingredient;

  const usages = await prisma.recipeIngredient.findMany({
    where: { ingredientId },
    select: {
      id: true,
      quantity: true,
      unit: true,
      recipe: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { recipe: { name: "asc" } },
  });

  const normalizedPackagedUnit = packagedUnit.toLowerCase();

  const rows: ConversionCandidateRow[] = usages.map((u) => {
    const base = {
      recipeIngredientId: u.id,
      recipeId: u.recipe.id,
      recipeSlug: u.recipe.slug,
      recipeName: u.recipe.name,
      quantity: u.quantity,
      unit: u.unit,
    };

    if (u.quantity == null) {
      return {
        ...base,
        matchType: "no-quantity" as const,
        suggestedQuantity: null,
        suggestedUnit: null,
        alternateQuantity: null,
        assumedDensity: false,
      };
    }

    const normalizedUnit = normalizeUnitLabel(u.unit);
    if (normalizedUnit === packagedUnitBase) {
      return {
        ...base,
        matchType: "already-base" as const,
        suggestedQuantity: null,
        suggestedUnit: null,
        alternateQuantity: null,
        assumedDensity: false,
      };
    }

    if (u.unit == null) {
      // Below this, a bare number is too small to plausibly already be
      // the base unit (0.75ml of creme fraiche isn't a real recipe
      // amount) but fits perfectly as a packaged-unit count (¾ pot) —
      // see missing-unit-ambiguous in the doc comment above.
      const AMBIGUITY_THRESHOLD = packagedUnitQuantity * 0.1;
      if (u.quantity < AMBIGUITY_THRESHOLD) {
        return {
          ...base,
          matchType: "missing-unit-ambiguous" as const,
          suggestedQuantity: u.quantity,
          suggestedUnit: packagedUnitBase,
          alternateQuantity: u.quantity * packagedUnitQuantity,
          assumedDensity: false,
        };
      }
      return {
        ...base,
        matchType: "missing-unit" as const,
        suggestedQuantity: u.quantity,
        suggestedUnit: packagedUnitBase,
        alternateQuantity: null,
        assumedDensity: false,
      };
    }

    if (u.unit.toLowerCase() === normalizedPackagedUnit) {
      return {
        ...base,
        matchType: "packaged-unit-mention" as const,
        suggestedQuantity: u.quantity * packagedUnitQuantity,
        suggestedUnit: packagedUnitBase,
        alternateQuantity: null,
        assumedDensity: false,
      };
    }

    const isGramMlPair =
      (normalizedUnit === "g" && packagedUnitBase === "ml") || (normalizedUnit === "ml" && packagedUnitBase === "g");
    if (isGramMlPair) {
      return {
        ...base,
        matchType: "density-assumed" as const,
        suggestedQuantity: u.quantity,
        suggestedUnit: packagedUnitBase,
        alternateQuantity: null,
        assumedDensity: true,
      };
    }

    return {
      ...base,
      matchType: "other-unit" as const,
      suggestedQuantity: null,
      suggestedUnit: null,
      alternateQuantity: null,
      assumedDensity: false,
    };
  });

  // Most-actionable first; "already-base" and "other-unit" are noise best
  // left at the bottom.
  const MATCH_TYPE_ORDER: Record<ConversionMatchType, number> = {
    "packaged-unit-mention": 0,
    "missing-unit": 1,
    "density-assumed": 2,
    "missing-unit-ambiguous": 3,
    "already-base": 4,
    "other-unit": 5,
    "no-quantity": 6,
  };
  rows.sort(
    (a, b) =>
      MATCH_TYPE_ORDER[a.matchType] - MATCH_TYPE_ORDER[b.matchType] ||
      a.recipeName.localeCompare(b.recipeName),
  );

  return {
    ingredient: {
      id: ingredient.id,
      canonicalName: ingredient.canonicalName,
      packagedUnit,
      packagedUnitQuantity,
      packagedUnitBase,
    },
    rows,
  };
}
