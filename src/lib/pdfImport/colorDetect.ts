import sharp from "sharp";
import type { OcrLine } from "./ocr";

// How far the red channel must lead both green and blue (0–255 scale,
// measured over a line's whole bounding box, background included) to count
// as "printed in red" rather than ordinary near-black/grey body text. A
// bbox is mostly background, so this is deliberately low — see isReddishLine.
const RED_DOMINANCE_THRESHOLD = 15;

/**
 * Samples the average pixel color under one OCR'd line's bounding box
 * (within the same crop it was read from) and reports whether it looks
 * printed in red rather than the card's normal near-black — used to catch
 * HelloFresh's red-highlighted "optional ingredient" callouts (see e.g. the
 * Bacon Leek and Mushroom Pie card's "Custom Recipe" swap block) that plain
 * OCR text has no way to distinguish from a regular row.
 *
 * A bounding box is mostly white background around a thin stroke of ink, so
 * the box's mean color is background-diluted — white contributes equally to
 * every channel, so it doesn't skew the red-vs-green/blue *difference*, it
 * just shrinks it. RED_DOMINANCE_THRESHOLD is tuned low accordingly; expect
 * to retune once this has run against a real red-highlighted card.
 */
export async function isReddishLine(cropBuffer: Buffer, line: OcrLine): Promise<boolean> {
  if (!line.baseline) return false;
  const { x0, y0, x1, y1 } = line.baseline;
  const lineHeight = Math.max(4, y1 - y0);
  const left = Math.max(0, Math.round(x0));
  const top = Math.max(0, Math.round(y0 - lineHeight));
  const width = Math.max(1, Math.round(x1 - x0));
  const height = Math.max(1, Math.round(lineHeight * 2));

  const meta = await sharp(cropBuffer).metadata();
  const maxWidth = Math.max(0, (meta.width ?? left + width) - left);
  const maxHeight = Math.max(0, (meta.height ?? top + height) - top);
  const clampedWidth = Math.min(width, maxWidth);
  const clampedHeight = Math.min(height, maxHeight);
  if (clampedWidth <= 0 || clampedHeight <= 0) return false;

  const { channels } = await sharp(cropBuffer)
    .extract({ left, top, width: clampedWidth, height: clampedHeight })
    .stats();
  const [r, g, b] = channels;
  return r.mean - g.mean > RED_DOMINANCE_THRESHOLD && r.mean - b.mean > RED_DOMINANCE_THRESHOLD;
}
