"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseCardPdf, toDraftRecipeData, UnsupportedCardLayoutError } from "./parseCardPdf";
import { saveDraftImages, deleteDraftImages } from "./imageStorage";

/**
 * Parses every uploaded PDF into its own PdfImportDraft row, so a batch of
 * scanned cards can be dropped in at once and reviewed one at a time
 * afterwards rather than blocking on a single review screen per upload.
 * A file that fails to parse doesn't stop the rest of the batch — its name
 * comes back via the redirect so the upload page can show what happened.
 */
export async function uploadPdfImports(formData: FormData): Promise<void> {
  const files = formData.getAll("pdfs").filter((f): f is File => f instanceof File && f.size > 0);
  const failed: string[] = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parseCardPdf(bytes);
      const draft = await prisma.pdfImportDraft.create({
        data: {
          originalFilename: file.name,
          templateId: parsed.templateId,
          data: toDraftRecipeData(parsed) as unknown as object,
        },
      });
      await saveDraftImages(draft.id, parsed);
    } catch (err) {
      const message = err instanceof UnsupportedCardLayoutError ? err.message : String(err);
      failed.push(`${file.name}: ${message}`);
    }
  }

  revalidatePath("/recipes/import");
  if (failed.length > 0) {
    redirect(`/recipes/import?failed=${encodeURIComponent(failed.join("|"))}`);
  }
  redirect("/recipes/import");
}

export async function discardPdfImportDraft(draftId: string): Promise<void> {
  await deleteDraftImages(draftId);
  await prisma.pdfImportDraft.delete({ where: { id: draftId } });
  revalidatePath("/recipes/import");
}
