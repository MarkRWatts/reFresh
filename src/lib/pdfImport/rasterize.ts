import { createCanvas } from "@napi-rs/canvas";
// pdfjs-dist's non-legacy build assumes a DOM (Path2D, ImageData, etc. as
// globals); the legacy build is the one that actually runs standalone in
// Node, despite the name suggesting it's for old bundlers.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export interface RasterPage {
  pageNumber: number;
  width: number;
  height: number;
  png: Buffer;
}

// 300dpi (pages are sized in 72pt/inch units) — enough headroom for OCR
// legibility on body text without ballooning render time/memory.
const RENDER_SCALE = 300 / 72;

/** Renders every page of a PDF to a raster PNG, at a fixed DPI, via pdfjs-dist + a headless canvas (no system Cairo/Poppler dependency — @napi-rs/canvas ships prebuilt binaries). */
export async function rasterizePdf(pdfBytes: Uint8Array): Promise<RasterPage[]> {
  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const pages: RasterPage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    // @napi-rs/canvas's context is duck-type compatible with what pdfjs's
    // renderer actually calls, but doesn't implement the full (irrelevant,
    // browser-only) CanvasRenderingContext2D surface pdfjs's types demand.
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

    await page.render({
      canvasContext: ctx,
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;
    const png = await canvas.encode("png");
    pages.push({ pageNumber, width: canvas.width, height: canvas.height, png: Buffer.from(png) });
  }

  return pages;
}
