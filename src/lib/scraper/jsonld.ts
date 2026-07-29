/** Loosely-typed shape of the schema.org Recipe JSON-LD HelloFresh embeds on every recipe page. */
export interface RecipeJsonLd {
  "@type": string;
  name: string;
  description?: string;
  image?: string | string[];
  totalTime?: string;
  recipeYield?: string | number | string[];
  recipeCategory?: string;
  recipeCuisine?: string;
  recipeIngredient?: string[];
  nutrition?: {
    calories?: string;
    [key: string]: unknown;
  };
  aggregateRating?: {
    ratingValue?: string | number;
    ratingCount?: string | number;
  };
  [key: string]: unknown;
}

/**
 * Extracts every <script type="application/ld+json"> block from raw HTML
 * and returns the one whose @type is "Recipe" (handling @graph wrappers
 * just in case), or null if none is found / parseable.
 */
export function extractRecipeJsonLd(html: string): RecipeJsonLd | null {
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "@graph" in (parsed as object)
        ? (parsed as { "@graph": unknown[] })["@graph"]
        : [parsed];

    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === "object" &&
        (candidate as { "@type"?: string })["@type"] === "Recipe"
      ) {
        return candidate as RecipeJsonLd;
      }
    }
  }

  return null;
}
