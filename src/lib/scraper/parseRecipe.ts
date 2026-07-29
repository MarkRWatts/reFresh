import { extractRecipeAppData, extractRecipeSteps, type RecipeStep } from "./appData";
import { extractRecipeJsonLd } from "./jsonld";
import {
  parseCalories,
  parseInstructions,
  parseIsoDurationToMinutes,
  parseRecipeUrlIds,
  parseServings,
  splitNameAndSubtitle,
  toNumberOrNull,
  toStringOrNull,
} from "./fieldParsers";
import { parseIngredientLine, type ParsedIngredientLine } from "./ingredientParser";
import { classifyProteinType, type ProteinType } from "./proteinType";

export type { RecipeStep };

export interface ParsedRecipe {
  hfId: string;
  slug: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string;
  cookMinutes: number | null;
  servings: number | null;
  calories: number | null;
  proteinType: ProteinType;
  cuisine: string | null;
  category: string | null;
  steps: RecipeStep[];
  ratingValue: number | null;
  ratingCount: number | null;
  ingredients: ParsedIngredientLine[];
  isPublished: boolean;
  isActive: boolean;
}

export class RecipeParseError extends Error {}

/**
 * Parses a fetched recipe page (its final, post-redirect URL and raw HTML)
 * into a normalized record ready for the DB. `finalUrl` matters because
 * HelloFresh sometimes redirects a sitemap URL to a different recipe
 * variant id, and that final URL is the true source of truth.
 */
export function parseRecipePage(finalUrl: string, html: string): ParsedRecipe {
  const jsonLd = extractRecipeJsonLd(html);
  if (!jsonLd) {
    throw new RecipeParseError(`No Recipe JSON-LD found at ${finalUrl}`);
  }
  if (!jsonLd.name || !Array.isArray(jsonLd.recipeIngredient)) {
    throw new RecipeParseError(`Recipe JSON-LD at ${finalUrl} is missing name/ingredients`);
  }

  const { hfId, slug } = parseRecipeUrlIds(finalUrl);
  const { name, subtitle } = splitNameAndSubtitle(jsonLd.name);
  const ingredients = jsonLd.recipeIngredient.map(parseIngredientLine);

  const proteinType = classifyProteinType({
    ingredientNames: ingredients.map((i) => i.name),
    name: jsonLd.name,
    category: jsonLd.recipeCategory,
    cuisine: jsonLd.recipeCuisine,
  });

  const image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
  const ratingCount = toNumberOrNull(jsonLd.aggregateRating?.ratingCount);
  const appData = extractRecipeAppData(html);
  // The internal app data has richer per-step content (images, captions)
  // than the JSON-LD's text-only recipeInstructions; fall back to the
  // latter only if that internal record isn't present at all.
  const steps =
    extractRecipeSteps(html) ??
    parseInstructions(jsonLd.recipeInstructions).map((text) => ({
      text,
      imageUrl: null,
      caption: null,
    }));

  return {
    hfId,
    slug,
    name,
    subtitle,
    description: toStringOrNull(jsonLd.description),
    imageUrl: toStringOrNull(image),
    sourceUrl: finalUrl,
    cookMinutes: parseIsoDurationToMinutes(jsonLd.totalTime),
    servings: parseServings(jsonLd.recipeYield),
    calories: parseCalories(jsonLd.nutrition?.calories),
    proteinType,
    cuisine: toStringOrNull(jsonLd.recipeCuisine),
    category: toStringOrNull(jsonLd.recipeCategory),
    steps,
    ratingValue: toNumberOrNull(jsonLd.aggregateRating?.ratingValue),
    ratingCount: ratingCount != null ? Math.round(ratingCount) : null,
    ingredients,
    isPublished: appData?.isPublished ?? true,
    isActive: appData?.active ?? true,
  };
}
