import sharp from "sharp";
import type { OcrLine } from "./ocr";
import { recognizeLines } from "./ocr";
import type { RasterPage } from "./rasterize";

// Below this, straightening would introduce more resampling blur than the
// skew itself costs in crop accuracy — not worth the (lossy) rotation.
const SKEW_CORRECTION_THRESHOLD_DEGREES = 0.3;

// A short baseline (a stray character, a single digit) gives a noisy angle
// estimate — only trust ones wide enough that a couple of misplaced pixels
// at each end can't swing the slope much.
const MIN_BASELINE_WIDTH_PX = 80;

/**
 * Estimates how many degrees a page's content is rotated clockwise from
 * upright, from the tilt of its OCR'd text-line baselines (see
 * OcrLine.baseline) — the median across every sufficiently-wide line, which
 * is robust to the odd stray/misfit baseline without needing to reject
 * outliers explicitly. Positive = rotated clockwise; pass the *negative* of
 * this to sharp's rotate() to straighten the page (see deskewPage).
 *
 * Pure/sync so it's cheap to unit test against synthetic OcrLine data —
 * callers are responsible for the actual (expensive) full-page OCR pass
 * that produces `lines` (see deskewPage).
 */
export function detectSkewAngle(lines: OcrLine[]): number {
  const angles: number[] = [];
  for (const line of lines) {
    if (!line.baseline) continue;
    const { x0, y0, x1, y1 } = line.baseline;
    if (x1 - x0 < MIN_BASELINE_WIDTH_PX) continue;
    angles.push((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
  }
  if (angles.length === 0) return 0;
  angles.sort((a, b) => a - b);
  const mid = Math.floor(angles.length / 2);
  return angles.length % 2 === 0 ? (angles[mid - 1] + angles[mid]) / 2 : angles[mid];
}

/**
 * Runs one full-page OCR pass and, if its content is measurably rotated,
 * returns a straightened copy (re-rasterized at the corrected orientation).
 * Returns the original page unchanged when the page reads as already
 * upright (or no lines had a usable baseline at all) — most imports should
 * hit this path and pay for the OCR pass but not the rotation.
 */
export async function deskewPage(page: RasterPage): Promise<RasterPage> {
  const lines = await recognizeLines(page.png);
  const angle = detectSkewAngle(lines);
  if (Math.abs(angle) < SKEW_CORRECTION_THRESHOLD_DEGREES) return page;

  const rotated = await sharp(page.png)
    .rotate(-angle, { background: "#ffffff" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    pageNumber: page.pageNumber,
    width: rotated.info.width,
    height: rotated.info.height,
    png: rotated.data,
  };
}

export interface AnchorMatch {
  /** Fractional (0–1) position of the left end of the matched line's baseline. */
  left: number;
  /** Fractional (0–1) vertical center of the matched line. */
  top: number;
}

function lineMatchesLabel(line: OcrLine, label: string): boolean {
  return line.baseline != null && line.text.toLowerCase().includes(label.toLowerCase());
}

/** Finds every OCR'd line whose text contains `label` (case-insensitive), reporting each match's fractional position on the page. A common word like "nutrition" or "ingredients" isn't unique to its section header — small print elsewhere on the card (allergen notices, substitution disclaimers) routinely repeats it — so this returns every hit rather than guessing which one matters; see findAnchor for how a caller picks the right one. */
export function findAllAnchors(lines: OcrLine[], label: string, pageWidth: number, pageHeight: number): AnchorMatch[] {
  return lines
    .filter((l) => lineMatchesLabel(l, label))
    .map((l) => ({ left: l.baseline!.x0 / pageWidth, top: l.y / pageHeight }));
}

/**
 * The match for `label` closest to `near` — a template's RegionAnchor
 * carries where its header text sat in the reference sample it was
 * calibrated against (regions.ts), and the real header on a given scan
 * should be close to that even accounting for layout drift. Picking
 * "closest to expected" rather than e.g. "first on the page" matters
 * because the same word routinely appears again, unrelated, elsewhere on
 * the card (confirmed against a real scan: "ingredients" turned up both in
 * the section header and in a substitutions disclaimer several times
 * further down the page — picking the wrong one sent every ingredient-row
 * crop into that disclaimer's paragraph instead of the ingredient table).
 * Null if the text doesn't appear anywhere on the page at all.
 */
export function findAnchor(
  lines: OcrLine[],
  label: string,
  pageWidth: number,
  pageHeight: number,
  near: { left: number; top: number },
): AnchorMatch | null {
  const matches = findAllAnchors(lines, label, pageWidth, pageHeight);
  if (matches.length === 0) return null;
  matches.sort((a, b) => Math.hypot(a.left - near.left, a.top - near.top) - Math.hypot(b.left - near.left, b.top - near.top));
  return matches[0];
}

/**
 * Finds distinct value-column header positions within a vertical band below
 * `nearTop` (e.g. just under a detected "Nutrition" header) — used to
 * locate a nutrition table's actual value column(s) directly from the
 * card's own "Per serving"/"Per 100g" header row, rather than trusting a
 * fixed offset from the section anchor.
 *
 * Matches the standalone word "per" rather than the phrase "per serving":
 * against a real scan, Tesseract reads a multi-line header cell ("Per" /
 * "serving" stacked, wrapped within its narrow column) as two *separate*
 * OcrLines at different y positions, so "per serving" as one line's text
 * never actually matches — "per" alone, restricted to lines right under the
 * section header, does. A card with a "Custom Recipe" swap block (see e.g.
 * Bacon Leek and Mushroom Pie) prints two such header pairs — a base
 * "Per serving / Per 100g" and a second one for the optional ingredient —
 * so 4 matches (not 2) is the signal that a swap block is present at all;
 * see correctPage2Regions.
 */
export function findColumnHeaderPositions(
  lines: OcrLine[],
  nearTop: number,
  pageWidth: number,
  pageHeight: number,
  bandHeight = 0.08,
): number[] {
  const xs = lines
    .filter((l) => l.baseline && /^per$/i.test(l.text.trim()) && Math.abs(l.y / pageHeight - nearTop) < bandHeight)
    .map((l) => l.baseline!.x0 / pageWidth)
    .sort((a, b) => a - b);

  // Collapse near-duplicate reads of the same header (OCR splitting one
  // header into adjacent fragments) rather than a real second column.
  const deduped: number[] = [];
  for (const x of xs) {
    if (deduped.length === 0 || x - deduped[deduped.length - 1] > 0.02) deduped.push(x);
  }
  return deduped;
}
