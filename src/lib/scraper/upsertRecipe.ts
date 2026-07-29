import { prisma } from "@/lib/db";
import { canonicalizeIngredientName } from "./ingredientNormalize";
import type { ParsedRecipe } from "./parseRecipe";

/**
 * Some scraped pages aren't a real cookable recipe: legacy/empty stub
 * entries with no ingredients at all, or things like GAP-filler
 * placeholders, internal test recipes ("Andre Test Prawn Creamy Pasta"),
 * box-bundle components, and serving-suggestion platters (e.g. a cheese
 * board) — identifiable by an explicit "0 minutes" cook time combined with
 * no real method. Genuine recipes that merely lack a published cook time
 * still have full instructions, so requiring both conditions avoids hiding
 * them (verified against the scraped sample before adding this check).
 */
function computeIsBrowsable(parsed: ParsedRecipe): boolean {
  if (parsed.ingredients.length === 0) return false;
  if (parsed.cookMinutes === 0 && parsed.instructions.length <= 1) return false;
  return true;
}

// Recipes are processed concurrently (see asyncPool in scripts/scrape.ts), so
// the same alias name (e.g. "Garlic Clove") — or two different alias
// spellings that canonicalize to the same ingredient, e.g. "Beef Stock Pot"
// vs. "Beef Stock Pots" — can be resolved by two recipes at once. Rather
// than each concurrent caller independently checking "does this exist?" and
// racing on the create, every resolution is single-flighted through a
// promise cache keyed first by alias name and, for new ingredients, also by
// canonical name — concurrent callers just await the same in-flight promise.
const ingredientIdByAliasName = new Map<string, Promise<string>>();
const ingredientCreationByCanonicalName = new Map<string, Promise<string>>();

function getOrCreateIngredientId(canonicalName: string): Promise<string> {
  const inFlight = ingredientCreationByCanonicalName.get(canonicalName);
  if (inFlight) return inFlight;

  const creation = prisma.ingredient
    .upsert({ where: { canonicalName }, create: { canonicalName }, update: {} })
    .then((ingredient) => ingredient.id);
  ingredientCreationByCanonicalName.set(canonicalName, creation);
  return creation;
}

function resolveIngredientId(name: string): Promise<string> {
  const inFlight = ingredientIdByAliasName.get(name);
  if (inFlight) return inFlight;

  const resolution = (async () => {
    const existingAlias = await prisma.ingredientAlias.findUnique({
      where: { rawText: name },
    });
    if (existingAlias) return existingAlias.ingredientId;

    const canonicalName = canonicalizeIngredientName(name);
    const ingredientId = await getOrCreateIngredientId(canonicalName);

    // The canonical name itself may differ from this raw alias text
    // (e.g. canonical "garlic clove" vs. alias "Garlic Cloves"); make sure
    // both resolve, without erroring if the alias already exists.
    await prisma.ingredientAlias.upsert({
      where: { rawText: name },
      create: { rawText: name, ingredientId },
      update: {},
    });

    return ingredientId;
  })();

  ingredientIdByAliasName.set(name, resolution);
  return resolution;
}

/**
 * Upserts a parsed recipe and fully replaces its ingredient rows. Recipes
 * are keyed on `hfId`, which is derived from the final (post-redirect) URL,
 * so multiple sitemap URLs that resolve to the same recipe variant collapse
 * into a single row automatically.
 */
export async function upsertRecipe(parsed: ParsedRecipe): Promise<void> {
  const existing = await prisma.recipe.findUnique({ where: { hfId: parsed.hfId } });

  const proteinType =
    existing?.proteinTypeManualOverride ? existing.proteinType : parsed.proteinType;
  const isBrowsable = computeIsBrowsable(parsed);

  const recipe = await prisma.recipe.upsert({
    where: { hfId: parsed.hfId },
    create: {
      hfId: parsed.hfId,
      slug: parsed.slug,
      name: parsed.name,
      subtitle: parsed.subtitle,
      description: parsed.description,
      imageUrl: parsed.imageUrl,
      sourceUrl: parsed.sourceUrl,
      cookMinutes: parsed.cookMinutes,
      servings: parsed.servings,
      calories: parsed.calories,
      proteinType,
      cuisine: parsed.cuisine,
      category: parsed.category,
      instructions: parsed.instructions,
      ratingValue: parsed.ratingValue,
      ratingCount: parsed.ratingCount,
      isBrowsable,
    },
    update: {
      slug: parsed.slug,
      name: parsed.name,
      subtitle: parsed.subtitle,
      description: parsed.description,
      imageUrl: parsed.imageUrl,
      sourceUrl: parsed.sourceUrl,
      cookMinutes: parsed.cookMinutes,
      servings: parsed.servings,
      calories: parsed.calories,
      proteinType,
      cuisine: parsed.cuisine,
      category: parsed.category,
      instructions: parsed.instructions,
      ratingValue: parsed.ratingValue,
      ratingCount: parsed.ratingCount,
      isBrowsable,
      lastScrapedAt: new Date(),
    },
  });

  await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });

  for (const ingredient of parsed.ingredients) {
    const ingredientId = await resolveIngredientId(ingredient.name);
    await prisma.recipeIngredient.create({
      data: {
        recipeId: recipe.id,
        ingredientId,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        rawText: ingredient.rawText,
      },
    });
  }
}
