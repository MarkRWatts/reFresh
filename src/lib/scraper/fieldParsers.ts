/** Coerces a JSON-LD field to a trimmed string, tolerating the occasional non-string value in older/stub recipe entries. Some old recipes use a literal `0` as a "field not set" sentinel (e.g. recipeCuisine), which is treated as absent rather than the string "0". */
export function toStringOrNull(value: unknown): string | null {
  if (value == null || value === 0) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

/** Coerces a JSON-LD field to a finite number, discarding garbage values instead of producing NaN. */
export function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Parses an ISO 8601 duration like "PT35M" or "PT1H10M" into whole minutes. */
export function parseIsoDurationToMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  const totalMinutes =
    Number(days ?? 0) * 24 * 60 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60;
  return Math.round(totalMinutes);
}

/** Parses a nutrition.calories string like "750 kcal" into a plain integer. */
export function parseCalories(calories: string | undefined): number | null {
  if (!calories) return null;
  const match = /(\d+(?:\.\d+)?)/.exec(calories);
  return match ? Math.round(Number(match[1])) : null;
}

/** recipeYield can be a number, a numeric string, "Serves 2", or an array of these. */
export function parseServings(
  recipeYield: string | number | string[] | undefined,
): number | null {
  if (recipeYield == null) return null;
  const value = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield;
  if (typeof value === "number") return Math.round(value);
  const match = /(\d+(?:\.\d+)?)/.exec(String(value));
  return match ? Math.round(Number(match[1])) : null;
}

/**
 * HelloFresh recipe names are titled as "<Main Title> with <Sides/Extras>".
 * Splits on the first standalone "with" so the UI can show a bold title
 * plus a lighter subtitle line, matching the site's own card layout.
 */
export function splitNameAndSubtitle(fullName: string): {
  name: string;
  subtitle: string | null;
} {
  const match = /^(.*?)\swith\s(.+)$/i.exec(fullName.trim());
  if (!match) return { name: fullName.trim(), subtitle: null };
  return { name: match[1].trim(), subtitle: `with ${match[2].trim()}` };
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#39;": "'",
  "&apos;": "'",
  "&quot;": '"',
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
};

/** Strips HTML tags from a HelloFresh instruction step and decodes the handful of entities it actually uses, keeping only plain text (never rendered as raw HTML). */
function htmlToPlainText(html: string): string {
  let text = html.replace(/<\/p>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.replaceAll(entity, char);
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** Parses a JSON-LD recipeInstructions array (HowToStep objects) into ordered plain-text steps. */
export function parseInstructions(recipeInstructions: unknown): string[] {
  if (!Array.isArray(recipeInstructions)) return [];
  return recipeInstructions
    .map((step) => {
      const text = typeof step === "object" && step && "text" in step ? (step as { text?: unknown }).text : null;
      return typeof text === "string" ? htmlToPlainText(text) : null;
    })
    .filter((step): step is string => Boolean(step));
}

/**
 * Extracts a stable id + slug from a recipe URL, e.g.
 * ".../recipes/korma-baked-salmon-and-chips-69e0c9b84af8f3547a64b22d"
 * -> { hfId: "69e0c9b84af8f3547a64b22d", slug: "korma-baked-salmon-and-chips-69e0c9b84af8f3547a64b22d" }
 *
 * Falls back to using the whole slug as the id if no trailing hex token
 * is found (older recipe URLs use a shorter/differently-shaped id).
 */
export function parseRecipeUrlIds(url: string): { hfId: string; slug: string } {
  const pathname = new URL(url).pathname;
  const slug = pathname.replace(/^\/recipes\//, "").replace(/\/+$/, "");
  const idMatch = /-([0-9a-f]{16,})$/i.exec(slug);
  return { hfId: idMatch ? idMatch[1] : slug, slug };
}
