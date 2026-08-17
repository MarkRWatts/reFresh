import { createWorker, type Worker } from "tesseract.js";

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

/** Runs OCR on an image buffer (typically a cropped region of a rasterized page — see regions.ts) and returns the recognized plain text. */
export async function recognizeText(imageBuffer: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageBuffer);
  return data.text;
}

export interface OcrLine {
  text: string;
  /** Vertical center of the line within the crop, in pixels — lets callers match up rows read from two separately-cropped columns by position instead of by array index, which breaks whenever the two crops don't segment into the same number of lines (see parseCardPdf.ts). */
  y: number;
}

/** Like recognizeText, but returns each line with its vertical position instead of one flattened string. */
export async function recognizeLines(imageBuffer: Buffer): Promise<OcrLine[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageBuffer, {}, { blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.trim();
        if (text) lines.push({ text, y: (line.bbox.y0 + line.bbox.y1) / 2 });
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
