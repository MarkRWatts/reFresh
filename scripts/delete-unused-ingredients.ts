import "dotenv/config";
import { prisma } from "@/lib/db";

/**
 * Deletes every Ingredient with zero RecipeIngredient rows — nothing in
 * the app currently cleans these up when they're orphaned (editing a
 * recipe's ingredients, via the recipe editor or PDF-import commit,
 * deletes and recreates RecipeIngredient rows — see recipeEditActions.ts —
 * but never removes the Ingredient a corrected/renamed row leaves behind).
 * In practice these are almost always OCR noise from a PDF import that got
 * fixed during review (e.g. "Sesame Seeds 3)" -> "Sesame Seeds"), not
 * ingredients worth keeping around. IngredientAlias rows cascade-delete
 * with their ingredient. Safe to re-run.
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const unused = await prisma.ingredient.findMany({
    where: { recipeIngredients: { none: {} } },
    select: { id: true, canonicalName: true },
  });

  for (const ingredient of unused) {
    console.log(`DELETE  "${ingredient.canonicalName}"`);
  }

  if (!dryRun) {
    await prisma.ingredient.deleteMany({ where: { id: { in: unused.map((i) => i.id) } } });
  }

  console.log(`\n${dryRun ? "[dry run] " : ""}${unused.length} unused ingredient(s) deleted.`);
  await prisma.$disconnect();
}

main();
