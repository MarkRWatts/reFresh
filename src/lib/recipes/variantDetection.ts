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

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
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
  const uf = new UnionFind();
  const comparedPairs = new Set<string>();

  for (const recipe of recipes) {
    const rawSharedCounts = new Map<string, number>();
    for (const ingredientId of new Set(recipe.ingredientIds)) {
      for (const otherId of invertedIndex.get(ingredientId) ?? []) {
        if (otherId === recipe.id) continue;
        rawSharedCounts.set(otherId, (rawSharedCounts.get(otherId) ?? 0) + 1);
      }
    }

    for (const [otherId, rawShared] of rawSharedCounts) {
      if (rawShared < minSharedIngredients) continue;
      const pairKey = [recipe.id, otherId].sort().join("|");
      if (comparedPairs.has(pairKey)) continue;
      comparedPairs.add(pairKey);

      const other = byId.get(otherId);
      if (!other) continue;

      const overlap = weightedOverlap(recipe.ingredientIds, other.ingredientIds, idf);
      if (overlap >= similarityThreshold) {
        uf.union(recipe.id, otherId);
      }
    }
  }

  // Group by cluster root, then choose each cluster's primary.
  const clusters = new Map<string, RecipeForVariantDetection[]>();
  for (const recipe of recipes) {
    const root = uf.find(recipe.id);
    const group = clusters.get(root);
    if (group) group.push(recipe);
    else clusters.set(root, [recipe]);
  }

  const result = new Map<string, string>();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const primary = [...members].sort((a, b) => {
      if (b.completenessScore !== a.completenessScore) return b.completenessScore - a.completenessScore;
      return a.id.localeCompare(b.id);
    })[0];
    for (const member of members) {
      if (member.id !== primary.id) result.set(member.id, primary.id);
    }
  }

  return result;
}
