import "dotenv/config";
import { prisma } from "@/lib/db";
import { detectVariants, type RecipeForVariantDetection } from "@/lib/recipes/variantDetection";

async function main() {
  const recipes = await prisma.recipe.findMany({
    where: { isBrowsable: true },
    select: {
      id: true,
      name: true,
      ratingCount: true,
      steps: true,
      ingredients: { select: { ingredientId: true } },
    },
  });

  const input: RecipeForVariantDetection[] = recipes.map((r) => {
    const stepCount = Array.isArray(r.steps) ? r.steps.length : 0;
    return {
      id: r.id,
      ingredientIds: r.ingredients.map((i) => i.ingredientId),
      completenessScore: stepCount * 1000 + (r.ratingCount ?? 0),
    };
  });

  console.log(`Analyzing ${input.length} browsable recipes...`);
  const variantOf = detectVariants(input);
  console.log(`Found ${variantOf.size} recipes that are variants of another recipe.`);

  // Reset any previous run's assignments first, since clusters can change
  // as more of the catalog gets scraped.
  await prisma.recipe.updateMany({
    where: { variantOfId: { not: null } },
    data: { variantOfId: null },
  });

  let updated = 0;
  for (const [recipeId, primaryId] of variantOf) {
    await prisma.recipe.update({ where: { id: recipeId }, data: { variantOfId: primaryId } });
    updated++;
  }
  console.log(`Updated ${updated} recipes with a variantOfId.`);

  const byPrimary = new Map<string, string[]>();
  for (const [recipeId, primaryId] of variantOf) {
    const names = byPrimary.get(primaryId) ?? [];
    names.push(recipes.find((r) => r.id === recipeId)?.name ?? recipeId);
    byPrimary.set(primaryId, names);
  }
  console.log("\nSample clusters:");
  let shown = 0;
  for (const [primaryId, variantNames] of byPrimary) {
    if (shown >= 15) break;
    const primaryName = recipes.find((r) => r.id === primaryId)?.name ?? primaryId;
    console.log(`  PRIMARY: ${primaryName}`);
    for (const name of variantNames) console.log(`    variant: ${name}`);
    shown++;
  }

  await prisma.$disconnect();
}

main();
