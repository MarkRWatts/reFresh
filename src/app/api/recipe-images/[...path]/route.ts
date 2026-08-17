import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveRecipeImagePath } from "@/lib/pdfImport/imageStorage";

/** Serves PDF-import cover/step photos from RECIPE_IMAGES_DIR — a named Docker volume, not public/, since public/ is baked into the image at build time (see Dockerfile) and wouldn't survive a redeploy. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const filePath = resolveRecipeImagePath(segments);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await readFile(filePath);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
