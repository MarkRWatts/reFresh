import { createWorker, PSM, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

// Recognizing many small crops from the same card is much cheaper against
// one long-lived worker than spinning a fresh one (and reloading the "eng"
// model) per crop.
function getWorker(): Promise<Worker> {
  // cachePath keeps the downloaded eng.traineddata under the same .cache/
  // directory the scraper already uses (gitignored, and volume-mounted in
  // Docker — see docker-compose.yml) instead of dumping it in the repo root.
  if (!workerPromise) workerPromise = createWorker("eng", 1, { cachePath: ".cache/tesseract" });
  return workerPromise;
}

/**
 * Runs OCR on an image buffer (typically a cropped region of a rasterized
 * page — see regions.ts) and returns the recognized plain text.
 *
 * Explicitly sets SPARSE_TEXT rather than relying on the engine's default —
 * recognizeLines (below) changes this same shared worker's mode, so every
 * call needs to set the mode it actually wants rather than assume nothing
 * else has touched it. SPARSE_TEXT was picked over the seemingly-obvious
 * AUTO after AUTO turned out to return nothing at all for a small, sparse
 * crop (a time badge next to an icon) that worked fine before any of this
 * was explicit — tested side by side against multi-line prose crops
 * (titles, step paragraphs) too, where it reads identically to AUTO.
 */
export async function recognizeText(imageBuffer: Buffer): Promise<string> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const { data } = await worker.recognize(imageBuffer);
  return data.text;
}

export interface OcrLine {
  text: string;
  /** Vertical center of the line within the crop, in pixels — lets callers match up rows read from two separately-cropped columns by position instead of by array index, which breaks whenever the two crops don't segment into the same number of lines (see parseCardPdf.ts). */
  y: number;
  /**
   * The line's fitted baseline, in the same pixel space as `y` — null
   * whenever Tesseract couldn't fit one (very short/sparse lines). Used for
   * two things bbox alone can't give: the line's horizontal extent (deskew.ts's
   * findAnchor, colorDetect.ts's isReddishLine) and its precise tilt
   * (deskew.ts's detectSkewAngle) — a plain top/bottom bbox is noisier for
   * tilt than the baseline Tesseract already fits per line.
   */
  baseline: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** Like recognizeText, but returns each line with its vertical position instead of one flattened string. Used for narrow table-cell crops (ingredient names/quantities, nutrition labels/values) — SPARSE_TEXT suits a stack of short, disconnected lines far better than the default full-page-layout assumption, which was misreading digits as letters ("1" as "I") more often than not. */
export async function recognizeLines(imageBuffer: Buffer): Promise<OcrLine[]> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const { data } = await worker.recognize(imageBuffer, {}, { blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.trim();
        if (!text) continue;
        const baseline =
          line.baseline && line.baseline.x1 > line.baseline.x0
            ? { x0: line.baseline.x0, y0: line.baseline.y0, x1: line.baseline.x1, y1: line.baseline.y1 }
            : null;
        lines.push({ text, y: (line.bbox.y0 + line.bbox.y1) / 2, baseline });
      }
    }
  }
  return lines;
}

/** Releases the OCR worker. Call once at the end of a batch run (e.g. the CLI script) — not needed per-import in the server, where the worker should stay warm across requests. */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
