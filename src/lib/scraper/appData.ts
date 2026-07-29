/**
 * Beyond the SEO-oriented JSON-LD block, HelloFresh's recipe pages embed
 * their own internal recipe record in Next.js's __NEXT_DATA__ payload
 * (props.pageProps.ssrPayload.recipe), including publish-status fields
 * that never appear in the JSON-LD at all. Confirmed by comparing several
 * known-good recipes against known test/placeholder ones (e.g. "GAP £3.4",
 * "Andre Test Prawn Creamy Pasta"): every junk entry checked had
 * isPublished/active explicitly false, while real recipes had both true.
 * This is a far more authoritative signal than inferring from missing
 * content, so it's extracted as a second, independent data source.
 */
export interface RecipeAppData {
  isPublished: boolean;
  active: boolean;
}

export function extractRecipeAppData(html: string): RecipeAppData | null {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const recipe = (
    data as {
      props?: { pageProps?: { ssrPayload?: { recipe?: { isPublished?: unknown; active?: unknown } } } };
    }
  )?.props?.pageProps?.ssrPayload?.recipe;
  if (!recipe || typeof recipe !== "object") return null;

  // Only treat explicit `false` as unpublished/inactive — a missing field
  // (e.g. if HelloFresh's page shape changes) should default to "assume
  // it's a real recipe" rather than silently hiding content.
  return {
    isPublished: recipe.isPublished !== false,
    active: recipe.active !== false,
  };
}
