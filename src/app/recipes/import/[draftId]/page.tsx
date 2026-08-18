import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import BackLink from "@/components/BackLink";
import SubmitButton from "@/components/SubmitButton";
import { commitPdfImportDraft } from "@/lib/pdfImport/commitImport";
import { discardPdfImportDraft } from "@/lib/pdfImport/draftActions";
import { draftImageUrls } from "@/lib/pdfImport/imageStorage";
import type { DraftRecipeData } from "@/lib/pdfImport/parseCardPdf";

function TextField({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        step={type === "number" ? "any" : undefined}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}

export default async function ReviewImportPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  const draft = await prisma.pdfImportDraft.findUnique({ where: { id: draftId } });
  if (!draft) notFound();

  const data = draft.data as unknown as DraftRecipeData;
  const { coverImageUrl, stepImageUrls } = await draftImageUrls(draftId, data.steps.length);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Review import</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Read off a scan — check it over, fix anything wrong, then save. Nothing is stored until
        you submit below.
      </p>

      {data.warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">{data.warnings.length} thing(s) worth double-checking:</p>
          <ul className="mt-1 list-disc pl-5">
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <form action={commitPdfImportDraft.bind(null, draftId)} className="mt-6 space-y-6">
        <div className="relative aspect-[4/3] w-full max-w-xs overflow-hidden rounded-2xl bg-zinc-100">
          <Image src={coverImageUrl} alt="Cover" fill sizes="20rem" className="object-cover" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" name="name" defaultValue={data.name} />
          <TextField label="Subtitle" name="subtitle" defaultValue={data.subtitle ?? ""} />
          <TextField
            label="Cook minutes"
            name="cookMinutes"
            type="number"
            defaultValue={data.cookMinutes ?? ""}
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Servings (sets which quantities are saved)</span>
            <select
              name="servingIndex"
              defaultValue={0}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            >
              {data.servingCounts.map((count, i) => (
                <option key={count} value={i}>
                  {count} people
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            Ingredients ({data.ingredients.length})
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Quantities default to the first serving size read off the card — the figures for
            other sizes are shown for reference only, so if you pick a different serving size
            above, update the quantity fields to match. Qty accepts fractions (e.g. &ldquo;1/2&rdquo;
            or &ldquo;&frac12;&rdquo;) as well as decimals. Clear a name to drop that row; new
            ingredients can be added after saving, from the recipe&rsquo;s own edit page.
          </p>
          <div className="mt-3 space-y-2">
            {data.ingredients.map((row, i) => {
              const first = row.byServing[0];
              const reference = row.byServing
                .map((q, j) => `${data.servingCounts[j]}P: ${q.quantity ?? "?"} ${q.unit ?? ""}`.trim())
                .join(" · ");
              return (
                <div key={i} className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-2 first:border-t-0 first:pt-0">
                  <div className="w-20">
                    <TextField label="Qty" name="ingredientQuantity" defaultValue={first?.quantity ?? ""} />
                  </div>
                  <div className="w-24">
                    <TextField label="Unit" name="ingredientUnit" defaultValue={first?.unit ?? ""} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <TextField label="Name" name="ingredientName" defaultValue={row.name} />
                  </div>
                  <p className="basis-full text-xs text-zinc-400">{reference}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Nutrition (per serving)</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TextField label="Calories" name="calories" type="number" defaultValue={data.calories ?? ""} />
            <TextField label="Fat (g)" name="fatGrams" type="number" defaultValue={data.fatGrams ?? ""} />
            <TextField label="Saturates (g)" name="saturatedFatGrams" type="number" defaultValue={data.saturatedFatGrams ?? ""} />
            <TextField label="Carbs (g)" name="carbsGrams" type="number" defaultValue={data.carbsGrams ?? ""} />
            <TextField label="Sugar (g)" name="sugarGrams" type="number" defaultValue={data.sugarGrams ?? ""} />
            <TextField label="Protein (g)" name="proteinGrams" type="number" defaultValue={data.proteinGrams ?? ""} />
            <TextField label="Salt (g)" name="saltGrams" type="number" defaultValue={data.saltGrams ?? ""} />
            <TextField label="Fibre (g)" name="fiberGrams" type="number" defaultValue={data.fiberGrams ?? ""} />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Steps ({data.steps.length})</h2>
          <div className="mt-3 space-y-4">
            {data.steps.map((step, i) => (
              <div key={i} className="flex gap-3 border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0">
                {stepImageUrls[i] && (
                  <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                    <Image src={stepImageUrls[i]} alt={`Step ${i + 1}`} fill sizes="7rem" className="object-cover" />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <TextField label="Heading" name="stepHeading" defaultValue={step.heading ?? ""} />
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">Instructions</span>
                    <textarea
                      name="stepText"
                      defaultValue={step.text}
                      rows={3}
                      className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <SubmitButton
          label="Save recipe"
          pendingLabel="Saving…"
          className="inline-flex items-center rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-300 disabled:bg-emerald-300"
        />
      </form>

      <form action={discardPdfImportDraft.bind(null, draftId)} className="mt-3">
        <button type="submit" className="text-sm font-medium text-zinc-400 hover:text-red-600">
          Discard this import
        </button>
      </form>
    </main>
  );
}
