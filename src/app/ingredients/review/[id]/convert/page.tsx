import { notFound } from "next/navigation";
import BackLink from "@/components/BackLink";
import BulkConversionButton from "@/components/BulkConversionButton";
import IngredientConversionTable from "@/components/IngredientConversionTable";
import { applyGramRatioConversion, convertPackagedUnitMentionsToBase, rebaseIngredientToPackagedBase } from "@/lib/ingredients/actions";
import { getIngredientConversionReview } from "@/lib/ingredients/conversionQueries";

export default async function IngredientConversionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const review = await getIngredientConversionReview(id);
  if (!review) notFound();

  const { ingredient, rows } = review;
  const hasPackaging = ingredient.packagedUnit != null && ingredient.packagedUnitQuantity != null && ingredient.packagedUnitBase != null;
  const relabelCount = rows.filter((r) => r.matchType === "missing-unit" || r.matchType === "density-assumed").length;
  const packagedMentionCount = rows.filter((r) => r.matchType === "packaged-unit-mention").length;
  const ambiguousCount = rows.filter((r) => r.matchType === "missing-unit-ambiguous").length;
  const gramRatioCount = rows.filter((r) => r.matchType === "gram-ratio-known").length;

  return (
    <main className="w-full flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900 capitalize">
        {ingredient.canonicalName}
      </h1>
      {hasPackaging ? (
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          1 {ingredient.packagedUnit} = {ingredient.packagedUnitQuantity} {ingredient.packagedUnitBase} — recipes get
          normalized to {ingredient.packagedUnitBase}, the precise unit you&rsquo;d actually buy this in, rather than a
          purchase-size count. Nothing here is applied automatically.
          {ambiguousCount > 0 &&
            ` ${ambiguousCount} more recipe${ambiguousCount === 1 ? " has" : "s have"} a bare number too small to confidently be ${ingredient.packagedUnitBase} — probably meant as a ${ingredient.packagedUnit} count instead, so those need a pick between the two readings below rather than a bulk fix.`}
        </p>
      ) : (
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          No packaging defined yet for this ingredient — showing the raw quantity/unit every recipe records, so you can
          decide what the packaging should even be. Set it on the review list to unlock bulk conversion here.
        </p>
      )}

      {hasPackaging && (
        <>
          <BulkConversionButton
            label={`Fill in / relabel ${relabelCount} recipe${relabelCount === 1 ? "" : "s"} as ${ingredient.packagedUnitBase}`}
            resultLabel="Relabeled"
            eligibleCount={relabelCount}
            confirmMessage={
              `Fill in a missing unit, or relabel grams/ml, as "${ingredient.packagedUnitBase}" for ${relabelCount} recipe${relabelCount === 1 ? "" : "s"}?\n\n` +
              `The number itself won't change — a bare number is assumed to already be in ${ingredient.packagedUnitBase}, ` +
              `and a grams/ml mismatch assumes ~1g ≈ 1ml, a reasonable approximation for a dairy/liquid-ish product but not an exact conversion.`
            }
            action={rebaseIngredientToPackagedBase.bind(null, ingredient.id)}
          />
          <BulkConversionButton
            label={`Convert ${packagedMentionCount} "${ingredient.packagedUnit}" mention${packagedMentionCount === 1 ? "" : "s"} to ${ingredient.packagedUnitBase}`}
            resultLabel="Converted"
            eligibleCount={packagedMentionCount}
            confirmMessage={
              `Convert ${packagedMentionCount} recipe${packagedMentionCount === 1 ? "" : "s"} currently in "${ingredient.packagedUnit}" ` +
              `to ${ingredient.packagedUnitBase} (e.g. "1 ${ingredient.packagedUnit}" -> "${ingredient.packagedUnitQuantity}${ingredient.packagedUnitBase}")?\n\n` +
              `This multiplies out using the packaged size above, so the actual amount is preserved.`
            }
            action={convertPackagedUnitMentionsToBase.bind(null, ingredient.id)}
          />
          {ingredient.packagedUnitBaseGrams != null && (
            <BulkConversionButton
              label={`Convert ${gramRatioCount} gram recipe${gramRatioCount === 1 ? "" : "s"} to ${ingredient.packagedUnitBase}`}
              resultLabel="Converted"
              eligibleCount={gramRatioCount}
              confirmMessage={
                `Convert ${gramRatioCount} recipe${gramRatioCount === 1 ? "" : "s"} currently in grams to ${ingredient.packagedUnitBase}, ` +
                `using 1 ${ingredient.packagedUnitBase} = ${ingredient.packagedUnitBaseGrams}g?\n\n` +
                `Skim the table below first — this ratio may not hold at very different quantities (e.g. a measuring-spoon ` +
                `ratio derived from small amounts won't be right for a bulk/baking-scale amount). Use the per-row Apply ` +
                `button instead for any row that looks off.`
              }
              action={applyGramRatioConversion.bind(null, ingredient.id)}
            />
          )}
        </>
      )}

      <IngredientConversionTable rows={rows} ingredient={ingredient} />
    </main>
  );
}
