import { prisma } from "@/lib/db";
import { normalizeUnitLabel } from "./unitSynonyms";

export type ConversionMatchType =
  | "already-packaged"
  | "clean-match"
  | "no-clean-match"
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
  /** Only set for "clean-match" — the packagedUnit count this row's amount cleanly divides into (see nearestCleanFraction). */
  suggestedQuantity: number | null;
  /** True when the suggestion required treating grams and millilitres as equivalent (1g ≈ 1ml) — a reasonable approximation for a dairy/liquid-ish product, but a real assumption, not a unit conversion. Never computed silently without being flagged — see getIngredientConversionReview. */
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

// Denominators tried smallest-first, so a simpler fraction (½) wins over a
// coincidentally-close complex one (7/8) when both are within tolerance.
// Covers every fraction actually seen in this catalog so far (halves,
// thirds, quarters, fifths, eighths — see ingredientParser.ts's
// UNICODE_FRACTIONS) plus a couple of others that are plausible for
// recipe portions.
const NICE_DENOMINATORS = [1, 2, 3, 4, 5, 8];
const RELATIVE_TOLERANCE = 0.08;

/**
 * Finds the simplest "nice" fraction (whole, half, third, quarter, fifth,
 * eighth) a ratio is close to, or null if it doesn't land near any of
 * them — the line between "safe to auto-suggest" and "needs a human to
 * actually look at this recipe," per the caution the review page exists
 * for. Deliberately a heuristic, not a proof: it's there to separate the
 * obvious cases from the ones worth a closer look, not to make the
 * decision itself — the reviewer still has to hit Apply.
 */
export function nearestCleanFraction(ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  for (const d of NICE_DENOMINATORS) {
    const scaled = ratio * d;
    const nearestInt = Math.round(scaled);
    if (nearestInt === 0) continue;
    if (Math.abs(scaled - nearestInt) <= RELATIVE_TOLERANCE) {
      return nearestInt / d;
    }
  }
  return null;
}

/**
 * For one ingredient with a researched packaged-unit size (e.g. "1 pot(s)
 * of creme fraiche = 150ml" — see the ingredient review page), lists every
 * recipe that uses it and classifies how its current quantity/unit
 * relates to that packaged size: already expressed in the packaged unit,
 * a clean match worth converting ("150ml" -> "1 pot(s)"), an amount that
 * doesn't land near a clean fraction of a pack (left for manual
 * judgment), or a different unit entirely (e.g. "tbsp") this tool doesn't
 * attempt to relate. Returns null if the ingredient doesn't have a
 * complete packaged-unit definition yet.
 *
 * Never applies anything — see applyPackagedUnitConversion in actions.ts,
 * a per-row, human-triggered write. This is deliberately a recipe-by-
 * recipe decision, not an ingredient-wide rule: the same ingredient can
 * legitimately want a whole pot in one recipe and a genuinely odd amount
 * in another.
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
  const normalizedBase = normalizeUnitLabel(packagedUnitBase);

  const rows: ConversionCandidateRow[] = usages.map((u) => {
    const base = {
      recipeIngredientId: u.id,
      recipeId: u.recipe.id,
      recipeSlug: u.recipe.slug,
      recipeName: u.recipe.name,
      quantity: u.quantity,
      unit: u.unit,
    };

    if (u.unit && u.unit.toLowerCase() === normalizedPackagedUnit) {
      return { ...base, matchType: "already-packaged" as const, suggestedQuantity: null, assumedDensity: false };
    }
    if (u.quantity == null) {
      return { ...base, matchType: "no-quantity" as const, suggestedQuantity: null, assumedDensity: false };
    }

    const normalizedUnit = normalizeUnitLabel(u.unit);
    const isExactUnit = normalizedUnit === normalizedBase;
    // g and ml aren't actually the same measure, but for a dairy/liquid-ish
    // product they're close enough (density ~1) that it's worth surfacing
    // as a suggestion — just visibly flagged as an assumption (see
    // assumedDensity), never silently treated as equivalent to an exact
    // unit match.
    const isGramMlPair =
      (normalizedUnit === "g" && normalizedBase === "ml") || (normalizedUnit === "ml" && normalizedBase === "g");
    if (!isExactUnit && !isGramMlPair) {
      return { ...base, matchType: "other-unit" as const, suggestedQuantity: null, assumedDensity: false };
    }

    const ratio = u.quantity / packagedUnitQuantity;
    const clean = nearestCleanFraction(ratio);
    return clean != null
      ? { ...base, matchType: "clean-match" as const, suggestedQuantity: clean, assumedDensity: !isExactUnit }
      : { ...base, matchType: "no-clean-match" as const, suggestedQuantity: null, assumedDensity: !isExactUnit };
  });

  // Most-actionable first: clean matches are what a reviewer should look
  // at first, "already packaged" and "other unit" rows are informational
  // noise best left at the bottom.
  const MATCH_TYPE_ORDER: Record<ConversionMatchType, number> = {
    "clean-match": 0,
    "no-clean-match": 1,
    "already-packaged": 2,
    "other-unit": 3,
    "no-quantity": 4,
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
