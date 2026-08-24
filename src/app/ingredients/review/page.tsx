import Link from "next/link";
import BackLink from "@/components/BackLink";
import IngredientReviewSearch from "@/components/IngredientReviewSearch";
import IngredientReviewTable from "@/components/IngredientReviewTable";
import { listIngredientsForReview } from "@/lib/ingredients/queries";

const PAGE_SIZE = 50;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IngredientReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const search = first(raw.q) || undefined;
  const page = Math.max(1, Number.parseInt(first(raw.page) ?? "1", 10) || 1);

  const { rows, total, pageSize } = await listIngredientsForReview({ search, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/ingredients/review${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <BackLink className="text-sm text-zinc-500 hover:text-zinc-700" />

      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">Ingredient review</h1>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        Fix HelloFresh&rsquo;s naming inconsistencies, tag categories, and record real pack sizes
        (&ldquo;1 pot&rdquo; of soured cream is 150ml) so the shopping list totals correctly.
        Renaming an ingredient to match an existing one merges them together. Sorted by how many
        recipes use each ingredient, so the highest-impact ones come first.
      </p>

      <div className="mt-4">
        <IngredientReviewSearch initialValue={search ?? ""} />
      </div>

      <p className="mt-3 text-sm text-zinc-500">
        {total.toLocaleString()} ingredient{total === 1 ? "" : "s"}
      </p>

      <IngredientReviewTable rows={rows} />

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4 pb-12 text-sm">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-full border border-zinc-300 px-4 py-1.5 hover:border-zinc-400"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-full border border-zinc-200 px-4 py-1.5 text-zinc-300">Previous</span>
          )}
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-full border border-zinc-300 px-4 py-1.5 hover:border-zinc-400"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-full border border-zinc-200 px-4 py-1.5 text-zinc-300">Next</span>
          )}
        </div>
      )}
    </main>
  );
}
