import "dotenv/config";
import { prisma } from "@/lib/db";
import { parseIngredientLine } from "@/lib/scraper/ingredientParser";
import { resolveIngredientId } from "@/lib/recipes/ingredientResolution";

/**
 * Re-runs parseIngredientLine against every RecipeIngredient's stored
 * rawText (no re-fetching — the raw scraped line is already in the DB) and
 * fixes any row whose quantity/unit now comes out different, e.g. after a
 * parser bug fix. Originally written for the missing-fifths unicode
 * fraction gap (see ingredientParser.ts's UNICODE_FRACTIONS comment),
 * but written generically so any future parseIngredientLine fix can be
 * caught the same way, mirroring merge-ingredients.ts's role for
 * canonicalizeIngredientName changes.
 *
 * A row whose re-parse changes its `name` (not just quantity/unit) moves
 * to a different Ingredient — if that leaves its old Ingredient with zero
 * remaining usages, that row is deleted too (its aliases cascade), so a
 * parser fix doesn't just move the pollution instead of cleaning it up.
 * Safe to re-run: once every row's parse is stable, it's a no-op.
 *
 * Only touches scraped recipes (excludes isPdfImport/isUserCreated) —
 * those get their quantity/unit/name from independent editor fields (see
 * formFields.ts's readEditedIngredients), not from parseIngredientLine, so
 * a rawText that looks like it "doesn't match a fresh reparse" there is
 * expected, not drift to fix. Same exclusion `npm run reprocess` gets for
 * free by only ever upserting by hfId (see Recipe.clonedFromId's comment).
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await prisma.recipeIngredient.findMany({
    where: { recipe: { isPdfImport: false, isUserCreated: false } },
    select: { id: true, rawText: true, ingredientId: true, quantity: true, unit: true },
  });
  console.log(`Checking ${rows.length} RecipeIngredient rows...`);

  let fixed = 0;
  const oldIngredientIds = new Set<string>();

  for (const row of rows) {
    const reparsed = parseIngredientLine(row.rawText);
    if (reparsed.quantity === row.quantity && reparsed.unit === row.unit) continue;

    console.log(
      `FIX  "${row.rawText}" -> quantity=${reparsed.quantity} unit=${reparsed.unit} name="${reparsed.name}"`,
    );
    fixed++;
    oldIngredientIds.add(row.ingredientId);

    if (dryRun) continue;

    const ingredientId = await resolveIngredientId(reparsed.name);
    await prisma.recipeIngredient.update({
      where: { id: row.id },
      data: { ingredientId, quantity: reparsed.quantity, unit: reparsed.unit },
    });
  }

  let deletedIngredients = 0;
  if (!dryRun) {
    for (const id of oldIngredientIds) {
      const stillUsed = await prisma.recipeIngredient.count({ where: { ingredientId: id } });
      if (stillUsed === 0) {
        await prisma.ingredient.delete({ where: { id } });
        deletedIngredients++;
      }
    }
  }

  console.log(
    `\n${dryRun ? "[dry run] " : ""}${fixed} RecipeIngredient row(s) fixed, ` +
      `${deletedIngredients} now-orphaned Ingredient row(s) deleted.`,
  );

  await prisma.$disconnect();
}

main();
