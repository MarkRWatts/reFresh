export const LOGO_VIEW_BOX = "0 0 100 100";

/**
 * Leaf + fork fusion mark: a two-tone leaf whose veins are drawn as fork
 * tines — fresh food and recipes in one shape. Single source of truth for
 * both the header logo (Logo.tsx) and the generated favicon
 * (scripts/generate-favicon.ts writes this same markup to src/app/icon.svg
 * and rasterizes it into src/app/favicon.ico).
 */
export const LOGO_SVG_BODY = `
<path d="M50 12 C74 12 86 34 86 54 C86 76 68 90 50 90 L50 12 Z" fill="#059669"/>
<path d="M50 12 C26 12 14 34 14 54 C14 76 32 90 50 90 L50 12 Z" fill="#10b981"/>
<g stroke="#ffffff" stroke-width="3" stroke-linecap="round">
  <line x1="50" y1="26" x2="50" y2="60"/>
  <line x1="42" y1="26" x2="42" y2="52"/>
  <line x1="58" y1="26" x2="58" y2="52"/>
</g>
<line x1="50" y1="60" x2="50" y2="90" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
`.trim();
