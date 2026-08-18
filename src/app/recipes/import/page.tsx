import Link from "next/link";
import { prisma } from "@/lib/db";
import BackLink from "@/components/BackLink";
import SubmitButton from "@/components/SubmitButton";
import { uploadPdfImports, discardPdfImportDraft } from "@/lib/pdfImport/draftActions";
import type { DraftRecipeData } from "@/lib/pdfImport/parseCardPdf";

export default async function ImportPdfPage({
  searchParams,
}: {
  searchParams: Promise<{ failed?: string }>;
}) {
  const { failed } = await searchParams;
  const failedFiles = failed ? failed.split("|") : [];

  const drafts = await prisma.pdfImportDraft.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Import from a HelloFresh card</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Upload a scanned 2-page recipe card PDF. It&rsquo;s read automatically, but OCR on a scan
        is never perfect — you&rsquo;ll get a chance to review and fix everything before it&rsquo;s
        saved.
      </p>

      {failedFiles.length > 0 && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Couldn&apos;t parse {failedFiles.length} file(s):</p>
          <ul className="mt-1 list-disc pl-5">
            {failedFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        action={uploadPdfImports}
        className="mt-6 rounded-2xl border border-dashed border-zinc-300 p-6 text-center"
      >
        <input
          type="file"
          name="pdfs"
          accept="application/pdf"
          multiple
          required
          className="mx-auto block text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700"
        />
        <p className="mt-2 text-xs text-zinc-400">
          Each card is read with OCR — this can take a minute or more, longer for several at once.
        </p>
        <SubmitButton
          label="Upload"
          pendingLabel="Reading card(s)…"
          className="mt-4 inline-flex items-center rounded-full border border-emerald-600 bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-300 disabled:bg-emerald-300"
        />
      </form>

      {drafts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-900">Pending review ({drafts.length})</h2>
          <ul className="mt-2 space-y-2">
            {drafts.map((draft) => {
              const data = draft.data as unknown as DraftRecipeData;
              return (
                <li
                  key={draft.id}
                  className="flex items-center justify-between gap-2 rounded-2xl border border-zinc-200 p-4"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/recipes/import/${draft.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {data.name}
                    </Link>
                    <p className="truncate text-xs text-zinc-400">{draft.originalFilename}</p>
                    {data.warnings.length > 0 && (
                      <p className="mt-0.5 text-xs text-amber-600">
                        {data.warnings.length} thing{data.warnings.length === 1 ? "" : "s"} to check
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/recipes/import/${draft.id}`}
                      className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400"
                    >
                      Review
                    </Link>
                    <form action={discardPdfImportDraft.bind(null, draft.id)}>
                      <button
                        type="submit"
                        className="text-xs font-medium text-zinc-400 hover:text-red-600"
                      >
                        Discard
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
