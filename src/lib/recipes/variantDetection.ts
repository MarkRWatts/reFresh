/**
 * Detects near-duplicate recipes — HelloFresh frequently remixes the same
 * "hero" component (e.g. a fried chicken burger) with different sides
 * across separate weekly menus, producing recipes that are 60-80%
 * identical under different ids/names (confirmed example:
 * buffalo-inspired-fried-chicken-burger vs. the-buffalo-chicken, which
 * share the same chicken/breading/sauce but pair it with mac and cheese
 * vs. fries + slaw).
 *
 * Similarity can't be plain ingredient-set overlap: ubiquitous pantry
 * items (water, garlic clove, salt, olive oil — the most common
 * ingredients in the whole catalog) would make unrelated recipes look
 * similar just for both using salt. Each ingredient is weighted by
 * inverse document frequency (rare/distinctive ingredients like
 * "sriracha sauce" or "confit duck leg" count far more than common ones),
 * a standard fix for exactly this kind of false-positive risk.
 */

export interface RecipeIngredientSet {
  id: string;
  ingredientIds: string[];
}

/** ln((N+1)/(df+1)) + 1 — smoothed so every ingredient gets a positive weight, even one present in every recipe. */
export function computeIdfWeights(recipes: RecipeIngredientSet[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const recipe of recipes) {
    for (const ingredientId of new Set(recipe.ingredientIds)) {
      documentFrequency.set(ingredientId, (documentFrequency.get(ingredientId) ?? 0) + 1);
    }
  }

  const n = recipes.length;
  const idf = new Map<string, number>();
  for (const [ingredientId, df] of documentFrequency) {
    idf.set(ingredientId, Math.log((n + 1) / (df + 1)) + 1);
  }
  return idf;
}

function weightedSum(ingredientIds: string[], idf: Map<string, number>): number {
  let sum = 0;
  for (const id of ingredientIds) sum += idf.get(id) ?? 0;
  return sum;
}

/** Weighted overlap coefficient: weighted(A∩B) / min(weighted(A), weighted(B)). Using the smaller side as the denominator correctly scores "B is basically a remix of A's ingredients" even when A has extra side-dish ingredients B doesn't share. */
export function weightedOverlap(
  aIds: string[],
  bIds: string[],
  idf: Map<string, number>,
): number {
  const bSet = new Set(bIds);
  const shared = aIds.filter((id) => bSet.has(id));
  const sharedWeight = weightedSum(shared, idf);
  const aWeight = weightedSum(aIds, idf);
  const bWeight = weightedSum(bIds, idf);
  const denominator = Math.min(aWeight, bWeight);
  return denominator > 0 ? sharedWeight / denominator : 0;
}

export interface VariantDetectionOptions {
  /** Minimum raw (unweighted) shared ingredients before bothering to compute the weighted score — keeps candidate generation cheap. */
  minSharedIngredients?: number;
  /** Minimum weighted overlap coefficient to consider two recipes variants of each other. */
  similarityThreshold?: number;
}

export interface RecipeForVariantDetection extends RecipeIngredientSet {
  /** Used to pick which member of a cluster is the "primary" shown by default — higher is preferred. */
  completenessScore: number;
}

/**
 * Returns a map of recipeId -> primaryRecipeId for every recipe that's a
 * non-primary member of a detected variant cluster. Recipes not in the
 * map are either unclustered or are themselves the cluster's primary.
 *
 * Clustering is "direct-to-primary" (a star, not transitive union-find):
 * recipes are considered as primaries in order of decreasing completeness,
 * and a recipe only ever becomes a variant of a primary it is *itself*
 * directly similar to. An earlier union-find version chained recipes
 * together through intermediate near-duplicates (A~B~C implies A and C are
 * in the same cluster even if A and C share almost nothing), which was
 * fine at the ~1,000-recipe tuning sample but collapsed catastrophically
 * on the full ~16k catalog — far more recipes meant far more chains, and
 * one run merged HALF the browsable catalog into a handful of superclusters
 * (e.g. an "Asian Inspired Rice" cluster pulling in an unrelated "MCB Pork
 * Meatball Curry" via a chain of intermediate rice dishes). Requiring every
 * variant to be directly verified against its specific primary eliminates
 * that failure mode structurally, regardless of catalog size.
 */
export function detectVariants(
  recipes: RecipeForVariantDetection[],
  options: VariantDetectionOptions = {},
): Map<string, string> {
  const minSharedIngredients = options.minSharedIngredients ?? 6;
  const similarityThreshold = options.similarityThreshold ?? 0.8;

  const idf = computeIdfWeights(recipes);

  // Inverted index: ingredientId -> recipeIds containing it, for cheap
  // candidate generation (only recipes sharing >=1 ingredient are ever
  // compared, instead of all O(n^2) pairs).
  const invertedIndex = new Map<string, string[]>();
  for (const recipe of recipes) {
    for (const ingredientId of new Set(recipe.ingredientIds)) {
      const list = invertedIndex.get(ingredientId);
      if (list) list.push(recipe.id);
      else invertedIndex.set(ingredientId, [recipe.id]);
    }
  }

  const byId = new Map(recipes.map((r) => [r.id, r]));

  // Highest-completeness recipes get first claim to be a primary, so a
  // "best" member of a near-duplicate group is preferred over a lesser one
  // that happens to be processed first.
  const ordered = [...recipes].sort((a, b) => {
    if (b.completenessScore !== a.completenessScore) return b.completenessScore - a.completenessScore;
    return a.id.localeCompare(b.id);
  });

  const result = new Map<string, string>();
  const claimed = new Set<string>();

  for (const recipe of ordered) {
    if (claimed.has(recipe.id)) continue; // already a variant of an earlier (better) primary

    const rawSharedCounts = new Map<string, number>();
    for (const ingredientId of new Set(recipe.ingredientIds)) {
      for (const otherId of invertedIndex.get(ingredientId) ?? []) {
        if (otherId === recipe.id) continue;
        rawSharedCounts.set(otherId, (rawSharedCounts.get(otherId) ?? 0) + 1);
      }
    }

    for (const [otherId, rawShared] of rawSharedCounts) {
      if (rawShared < minSharedIngredients) continue;
      if (claimed.has(otherId) || otherId === recipe.id) continue;

      const other = byId.get(otherId);
      if (!other) continue;

      const overlap = weightedOverlap(recipe.ingredientIds, other.ingredientIds, idf);
      if (overlap >= similarityThreshold) {
        result.set(otherId, recipe.id);
        claimed.add(otherId);
      }
    }
  }

  return result;
}
