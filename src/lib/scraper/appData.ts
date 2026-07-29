import { htmlToPlainText } from "./fieldParsers";

/**
 * Beyond the SEO-oriented JSON-LD block, HelloFresh's recipe pages embed
 * their own internal recipe record in Next.js's __NEXT_DATA__ payload
 * (props.pageProps.ssrPayload.recipe). It carries fields the JSON-LD
 * doesn't: publish-status flags (see RecipeAppData) and, critically, a
 * per-step `images` array — the JSON-LD's recipeInstructions is text-only.
 */
interface InternalStep {
  instructionsHTML?: unknown;
  instructions?: unknown;
  images?: { path?: unknown; caption?: unknown }[];
}

interface InternalRecipe {
  isPublished?: unknown;
  active?: unknown;
  steps?: unknown;
}

function extractInternalRecipe(html: string): InternalRecipe | null {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const recipe = (data as { props?: { pageProps?: { ssrPayload?: { recipe?: InternalRecipe } } } })
    ?.props?.pageProps?.ssrPayload?.recipe;
  return recipe && typeof recipe === "object" ? recipe : null;
}

export interface RecipeAppData {
  isPublished: boolean;
  active: boolean;
}

/**
 * Confirmed by comparing several known-good recipes against known
 * test/placeholder ones (e.g. "GAP £3.4", "Andre Test Prawn Creamy
 * Pasta"): every junk entry checked had isPublished/active explicitly
 * false. NOTE: this turned out to be a poor filter signal on its own —
 * plenty of recipes retired from HelloFresh's current menu rotation are
 * also marked unpublished despite being completely legitimate (see
 * upsertRecipe.ts's computeIsBrowsable for what's actually used). Still
 * captured as informational metadata.
 */
export function extractRecipeAppData(html: string): RecipeAppData | null {
  const recipe = extractInternalRecipe(html);
  if (!recipe) return null;

  // Only treat explicit `false` as unpublished/inactive — a missing field
  // (e.g. if HelloFresh's page shape changes) should default to "assume
  // it's a real recipe" rather than silently hiding content.
  return {
    isPublished: recipe.isPublished !== false,
    active: recipe.active !== false,
  };
}

const STEP_IMAGE_BASE = "https://img.hellofresh.com/f_auto,fl_lossy,h_640,q_auto,w_1200/hellofresh_s3";

export interface RecipeStep {
  text: string;
  imageUrl: string | null;
  caption: string | null;
}

/**
 * Extracts ordered cooking steps with their per-step photo, when present
 * (e.g. korma-baked-salmon-and-chips has a distinct image + fun caption
 * like "Chip, Chip, Hooray" for each of its 6 steps — none of which is in
 * the JSON-LD at all). Returns null if the internal recipe record isn't
 * found, so callers can fall back to the JSON-LD's text-only instructions.
 */
export function extractRecipeSteps(html: string): RecipeStep[] | null {
  const recipe = extractInternalRecipe(html);
  if (!recipe || !Array.isArray(recipe.steps)) return null;

  return (recipe.steps as InternalStep[])
    .map((step): RecipeStep | null => {
      const rawHtml = step.instructionsHTML ?? step.instructions;
      if (typeof rawHtml !== "string") return null;
      const text = htmlToPlainText(rawHtml);
      if (!text) return null;

      const image = step.images?.[0];
      const path = typeof image?.path === "string" ? image.path : null;
      return {
        text,
        imageUrl: path ? `${STEP_IMAGE_BASE}${path}` : null,
        caption: typeof image?.caption === "string" ? image.caption : null,
      };
    })
    .filter((step): step is RecipeStep => step !== null);
}
