/**
 * Suggests weekly recipe combinations that maximize shared ingredients —
 * the actual point of this app (buy one bag of onions, use it across 3
 * meals instead of 3 half-used bags). Deliberately does NOT use the
 * IDF-weighting from variantDetection.ts: that algorithm needed to
 * down-weight common ingredients to avoid false "these are the same
 * recipe" matches, but here a shared common ingredient (onion, garlic) is
 * exactly the win we want to surface, not noise to filter out.
 *
 * Brute-forcing every N-recipe combination from a candidate pool is
 * infeasible even at a few hundred candidates, so this greedily grows a
 * set from a seed recipe — at each step, add whichever remaining
 * candidate shares the most ingredients with the set built so far — and
 * repeats from several seeds, keeping the best-scoring resulting sets.
 */

export interface RecipeIngredientSet {
  id: string;
  ingredientIds: string[];
  /** Used only to break ties between equally-good candidates (e.g. rating). Higher is preferred. */
  qualityScore: number;
}

export interface SuggestedCombination {
  recipeIds: string[];
  /** Sum over every ingredient shared by 2+ recipes in the set of (recipeCount - 1) — each "extra" shared use. */
  score: number;
}

/**
 * Total waste-reduction score for a fixed set: for an ingredient used by k
 * recipes in the set, it contributes max(0, k-1) — the number of
 * duplicate purchases avoided by sharing it.
 */
function computeTotalScore(sets: RecipeIngredientSet[]): number {
  const counts = new Map<string, number>();
  for (const s of sets) {
    for (const id of new Set(s.ingredientIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let total = 0;
  for (const count of counts.values()) total += Math.max(0, count - 1);
  return total;
}

/**
 * Greedily grows a set from `seed` up to `count` recipes. At each step,
 * the marginal score of adding a candidate equals the number of its
 * distinct ingredients already used somewhere in the set — adding any one
 * of those bumps that ingredient's count by exactly 1, which (per
 * computeTotalScore's definition) raises the total score by exactly 1
 * regardless of how many recipes already share it. So this greedy
 * criterion is exactly the marginal gain in the true objective, not an
 * approximation of it.
 */
function growFromSeed(
  seed: RecipeIngredientSet,
  pool: RecipeIngredientSet[],
  count: number,
): RecipeIngredientSet[] {
  const chosen = [seed];
  const usedIngredients = new Set(seed.ingredientIds);
  const remaining = pool.filter((r) => r.id !== seed.id);

  while (chosen.length < count && remaining.length > 0) {
    let bestIndex = -1;
    let bestMarginal = -1;
    let bestQuality = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const marginal = new Set(candidate.ingredientIds.filter((id) => usedIngredients.has(id)))
        .size;
      if (
        marginal > bestMarginal ||
        (marginal === bestMarginal && candidate.qualityScore > bestQuality)
      ) {
        bestIndex = i;
        bestMarginal = marginal;
        bestQuality = candidate.qualityScore;
      }
    }

    if (bestIndex === -1) break;
    const [chosenCandidate] = remaining.splice(bestIndex, 1);
    chosen.push(chosenCandidate);
    for (const id of chosenCandidate.ingredientIds) usedIngredients.add(id);
  }

  return chosen;
}

/**
 * Picks up to `seedCount` seeds, favoring higher-quality recipes but
 * sampling the rest of the pool too for variety between suggested
 * combinations.
 *
 * The top half used to be the literal top N by quality — fully
 * deterministic, so reloading /suggest (or the persisted-suggestion-history
 * exclusion in queries.ts not applying yet, e.g. a first-ever visit) kept
 * regrowing the same combinations from the same handful of top-rated
 * recipes. Sampling that half randomly from a wider top slice (instead of
 * always the literal best) fixes that while still favoring quality overall.
 */
function pickSeeds(pool: RecipeIngredientSet[], seedCount: number): RecipeIngredientSet[] {
  if (pool.length <= seedCount) return pool;
  const sorted = [...pool].sort((a, b) => b.qualityScore - a.qualityScore);
  const topHalf = Math.ceil(seedCount / 2);
  const topCandidates = sorted.slice(0, Math.min(sorted.length, topHalf * 2));
  const topSeeds = [...topCandidates].sort(() => Math.random() - 0.5).slice(0, topHalf);
  const rest = sorted.filter((r) => !topSeeds.includes(r));
  const randomSeeds = [...rest].sort(() => Math.random() - 0.5).slice(0, seedCount - topHalf);
  return [...topSeeds, ...randomSeeds];
}

export function suggestMealCombinations(
  pool: RecipeIngredientSet[],
  count: number,
  topK = 3,
  seedCount = 40,
): SuggestedCombination[] {
  if (pool.length < count || count <= 0) return [];

  const seeds = pickSeeds(pool, seedCount);
  const seen = new Set<string>();
  const results: SuggestedCombination[] = [];

  for (const seed of seeds) {
    const combo = growFromSeed(seed, pool, count);
    if (combo.length < count) continue;

    const key = combo
      .map((r) => r.id)
      .sort()
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ recipeIds: combo.map((r) => r.id), score: computeTotalScore(combo) });
  }

  results.sort((a, b) => b.score - a.score);

  // Each seed grows its combo independently over the full pool, so the
  // same individual recipe can easily end up the best marginal add for
  // several different seeds — without this, the same recipe could appear
  // in more than one of the returned options. Take the highest-scoring
  // combos in order, skipping any that reuse a recipe already claimed by
  // a better (earlier) one.
  const finalResults: SuggestedCombination[] = [];
  const usedRecipeIds = new Set<string>();
  for (const combo of results) {
    if (combo.recipeIds.some((id) => usedRecipeIds.has(id))) continue;
    finalResults.push(combo);
    for (const id of combo.recipeIds) usedRecipeIds.add(id);
    if (finalResults.length >= topK) break;
  }

  return finalResults;
}
