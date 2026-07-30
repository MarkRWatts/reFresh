import { prisma } from "@/lib/db";
import { canonicalizeIngredientName } from "@/lib/scraper/ingredientNormalize";

/**
 * Resolves a raw ingredient name (scraped or user-typed) to a canonical
 * Ingredient id, creating the canonical ingredient and/or alias row if
 * this exact raw text hasn't been seen before. Shared by the scraper
 * (scripts/scrape.ts, many recipes concurrently) and the custom-recipe
 * editor (a single manual add) so a user-typed "Garlic Clove" resolves to
 * the exact same canonical ingredient the scraper would have produced,
 * rather than forking into a duplicate.
 *
 * Concurrent callers can race on creating the same alias/canonical
 * ingredient, so every resolution is single-flighted through a promise
 * cache keyed first by alias name and, for new ingredients, also by
 * canonical name — concurrent callers just await the same in-flight
 * promise instead of double-creating.
 */
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

export function resolveIngredientId(name: string): Promise<string> {
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
