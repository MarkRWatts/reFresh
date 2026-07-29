/**
 * Some HelloFresh recipes publish an image URL that's just the CDN
 * transform-parameter prefix with no filename appended (e.g. ends in
 * ".../w_1200/") — a real gap in their own source data (confirmed: no
 * usable fallback image exists elsewhere on those pages either). Such
 * URLs are truthy strings, so a plain `imageUrl ?` check renders a
 * broken <img> instead of falling back to the placeholder.
 */
export function hasUsableImage(imageUrl: string | null): imageUrl is string {
  return !!imageUrl && !imageUrl.endsWith("/");
}
