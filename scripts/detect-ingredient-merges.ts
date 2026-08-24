import "dotenv/config";
import { prisma } from "@/lib/db";
import { canonicalizeIngredientName } from "@/lib/scraper/ingredientNormalize";
import { levenshteinDistance } from "@/lib/ingredients/levenshtein";

/**
 * Reports ingredient names that LOOK like they might be duplicates or
 * misspellings of each other — never merges anything itself. Re-run this
 * after every import batch (or periodically) as a human triage list.
 *
 * A hand-run version of this scan is what a long ingredient-cleanup
 * session used to find real duplicates ("eggs"->"egg", "radishe"->"radish",
 * "chili powder"->"chilli powder") — but it ALSO surfaced pairs that look
 * similar and genuinely aren't: "scallion" vs "scallop" (herb vs seafood),
 * "tamari sauce" vs "tamarind sauce" (soy vs fruit), "diced chicken
 * breast" vs "chicken breast" (different real-world purchase/measuring
 * units, not a naming variant — see ingredientNormalize.ts's prep-qualifier
 * comment). This tool's job is to surface candidates for a human to
 * decide on via the ingredient review page's rename/merge UI (see
 * renameOrMergeIngredient in actions.ts), not to resolve them — false
 * positives above are EXPECTED output, not bugs to filter out.
 *
 * --dry-run is accepted for command-line consistency with the sibling
 * scripts (merge-ingredients.ts, reparse-ingredient-lines.ts) but is a
 * no-op here: this script never writes anything, dry-run or not.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const ingredients = await prisma.ingredient.findMany({
    select: { id: true, canonicalName: true, _count: { select: { recipeIngredients: true } } },
  });
  const withUsage = ingredients.map((i) => ({ ...i, usage: i._count.recipeIngredients }));

  // Tier 1: exact match once re-canonicalized. Should be empty against a
  // catalog that's already been through merge-ingredients.ts — included
  // here anyway so a human gets one unified report instead of two tools.
  const byCanonical = new Map<string, typeof withUsage>();
  for (const ing of withUsage) {
    const key = canonicalizeIngredientName(ing.canonicalName);
    byCanonical.set(key, [...(byCanonical.get(key) ?? []), ing]);
  }
  const tier1 = [...byCanonical.entries()].filter(([, group]) => group.length > 1);

  console.log(`=== Tier 1: exact match after re-canonicalizing (${tier1.length}) ===`);
  for (const [key, group] of tier1) {
    console.log(`[${key}] ` + group.map((g) => `"${g.canonicalName}" (${g.usage} uses)`).join(" <-> "));
  }

  // Tier 2: close edit distance — likely typos/spelling variants.
  const norms = withUsage.map((i) => ({ ...i, norm: normalize(i.canonicalName) }));
  const tier2: string[] = [];
  const seen = new Set<string>();
  for (let a = 0; a < norms.length; a++) {
    for (let b = a + 1; b < norms.length; b++) {
      const A = norms[a];
      const B = norms[b];
      if (A.norm.length < 6 || B.norm.length < 6) continue;
      if (Math.abs(A.norm.length - B.norm.length) > 2) continue;
      const dist = levenshteinDistance(A.norm, B.norm);
      if (dist === 0 || dist > 2) continue;
      const key = [A.id, B.id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      tier2.push(`"${A.canonicalName}" (${A.usage}) <-> "${B.canonicalName}" (${B.usage}) [dist=${dist}]`);
    }
  }
  console.log(`\n=== Tier 2: close spelling, edit distance <= 2 (${tier2.length}) ===`);
  for (const line of tier2) console.log(line);

  // Tier 3: one name is the other plus exactly one extra word (prep/qualifier variants).
  const tier3: string[] = [];
  const byWordCount = [...norms].sort((a, b) => a.norm.split(" ").length - b.norm.split(" ").length);
  for (const A of byWordCount) {
    for (const B of byWordCount) {
      if (A.id === B.id) continue;
      const wordsA = A.norm.split(" ");
      const wordsB = B.norm.split(" ");
      if (wordsB.length - wordsA.length !== 1) continue;
      const isSubsequence = wordsA.every((w) => wordsB.includes(w));
      if (isSubsequence && A.usage >= 15 && B.usage >= 15) {
        tier3.push(`"${A.canonicalName}" (${A.usage}) ~ "${B.canonicalName}" (${B.usage})`);
      }
    }
  }
  console.log(`\n=== Tier 3: one extra word, both sides usage >= 15 (${tier3.length}) ===`);
  for (const line of tier3) console.log(line);

  console.log(
    `\n${tier1.length} tier-1, ${tier2.length} tier-2, ${tier3.length} tier-3 candidate(s) — review via the ingredient review page, nothing was changed.`,
  );

  await prisma.$disconnect();
}

main();
