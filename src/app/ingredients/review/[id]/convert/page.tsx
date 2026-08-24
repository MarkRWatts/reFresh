import { notFound } from "next/navigation";
import BackLink from "@/components/BackLink";
import IngredientConversionTable from "@/components/IngredientConversionTable";
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
  const cleanCount = rows.filter((r) => r.matchType === "clean-match").length;
  const needsJudgmentCount = rows.filter((r) => r.matchType === "no-clean-match").length;

  return (
    <main className="w-full flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900 capitalize">
        {ingredient.canonicalName}
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        1 {ingredient.packagedUnit} = {ingredient.packagedUnitQuantity} {ingredient.packagedUnitBase}.
        Nothing here is applied automatically — {cleanCount} recipe{cleanCount === 1 ? "" : "s"}{" "}
        {cleanCount === 1 ? "is" : "are"} a clean match worth a quick look, {needsJudgmentCount} more{" "}
        {needsJudgmentCount === 1 ? "doesn't" : "don't"} land near a whole/half/etc. pack and need an
        actual read of the recipe before you decide.
      </p>

      <IngredientConversionTable rows={rows} ingredient={ingredient} />
    </main>
  );
}
