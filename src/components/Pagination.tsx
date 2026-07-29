import Link from "next/link";
import { buildFilterQueryString, type ParsedFilters } from "@/lib/recipes/searchParamsUtil";

export default function Pagination({
  filters,
  total,
  pageSize,
}: {
  filters: ParsedFilters;
  total: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const { page } = filters;
  const prevHref = `/${buildFilterQueryString({ ...filters, page: page - 1 })}`;
  const nextHref = `/${buildFilterQueryString({ ...filters, page: page + 1 })}`;

  return (
    <div className="mt-8 flex items-center justify-center gap-4 pb-12 text-sm">
      {page > 1 ? (
        <Link href={prevHref} className="rounded-full border border-zinc-300 px-4 py-1.5 hover:border-zinc-400">
          Previous
        </Link>
      ) : (
        <span className="rounded-full border border-zinc-200 px-4 py-1.5 text-zinc-300">Previous</span>
      )}
      <span className="text-zinc-500">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={nextHref} className="rounded-full border border-zinc-300 px-4 py-1.5 hover:border-zinc-400">
          Next
        </Link>
      ) : (
        <span className="rounded-full border border-zinc-200 px-4 py-1.5 text-zinc-300">Next</span>
      )}
    </div>
  );
}
