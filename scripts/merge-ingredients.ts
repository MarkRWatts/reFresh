import "dotenv/config";
import { prisma } from "@/lib/db";
import { canonicalizeIngredientName } from "@/lib/scraper/ingredientNormalize";

/**
 * Re-canonicalizes every existing Ingredient's name through the current
 * canonicalizeIngredientName (see ingredientNormalize.ts) and merges any
 * that now collide — the one-off catch-up for existing data whenever that
 * function's rules change (e.g. the origin-qualifier stripping added
 * alongside this script, which unifies "British Chicken Breast" into
 * "Chicken Breast"). Safe to re-run: once everything's already
 * canonicalized under the current rules, it's a no-op.
 *
 * Within a merge group, the ingredient already carrying the most
 * RecipeIngredient rows becomes the survivor (most likely to already have
 * a sensible category/packaging set from prior review) — every other
 * member's RecipeIngredient and IngredientAlias rows are reassigned to it
 * before being deleted, so future scrapes reusing an already-seen raw
 * ingredient string keep resolving correctly (see resolveIngredientId,
 * which looks up by exact raw text before ever touching canonicalName).
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const ingredients = await prisma.ingredient.findMany({
    select: {
      id: true,
      canonicalName: true,
      _count: { select: { recipeIngredients: true } },
    },
  });

  const groups = new Map<string, typeof ingredients>();
  for (const ingredient of ingredients) {
    const recanonicalized = canonicalizeIngredientName(ingredient.canonicalName);
    const group = groups.get(recanonicalized);
    if (group) group.push(ingredient);
    else groups.set(recanonicalized, [ingredient]);
  }

  let renamed = 0;
  let merged = 0;
  let reassignedRecipeIngredientRows = 0;

  for (const [recanonicalized, members] of groups) {
    if (members.length === 1) {
      const [only] = members;
      if (only.canonicalName !== recanonicalized) {
        console.log(`RENAME  "${only.canonicalName}" -> "${recanonicalized}"`);
        renamed++;
        if (!dryRun) {
          await prisma.ingredient.update({
            where: { id: only.id },
            data: { canonicalName: recanonicalized },
          });
        }
      }
      continue;
    }

    const sorted = [...members].sort(
      (a, b) => b._count.recipeIngredients - a._count.recipeIngredients,
    );
    const [primary, ...losers] = sorted;
    console.log(
      `MERGE   "${recanonicalized}" <- ${losers.map((l) => `"${l.canonicalName}" (${l._count.recipeIngredients} uses)`).join(", ")}` +
        ` [primary: "${primary.canonicalName}" (${primary._count.recipeIngredients} uses)]`,
    );
    merged++;

    if (dryRun) continue;

    for (const loser of losers) {
      // Two ingredients could each have an existing RecipeIngredient row
      // for the same recipe (e.g. a recipe scraped once as "Chicken Breast"
      // and re-scraped later as "British Chicken Breast" would only ever
      // produce one row per recipe in practice, but guard anyway) — moving
      // duplicates would violate no constraint here since RecipeIngredient
      // has no unique(recipeId, ingredientId), so a plain reassignment is
      // safe either way.
      const { count } = await prisma.recipeIngredient.updateMany({
        where: { ingredientId: loser.id },
        data: { ingredientId: primary.id },
      });
      reassignedRecipeIngredientRows += count;

      await prisma.ingredientAlias.updateMany({
        where: { ingredientId: loser.id },
        data: { ingredientId: primary.id },
      });

      await prisma.ingredient.delete({ where: { id: loser.id } });
    }

    if (primary.canonicalName !== recanonicalized) {
      await prisma.ingredient.update({
        where: { id: primary.id },
        data: { canonicalName: recanonicalized },
      });
    }
  }

  console.log(
    `\n${dryRun ? "[dry run] " : ""}${renamed} renamed, ${merged} merge group(s) collapsed, ` +
      `${reassignedRecipeIngredientRows} RecipeIngredient rows reassigned.`,
  );

  await prisma.$disconnect();
}

main();
