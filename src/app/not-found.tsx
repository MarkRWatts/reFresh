import Link from "next/link";
import { CookingPot } from "lucide-react";

// Rendered for any route that doesn't match (bad URL) and by every
// notFound() call (recipe/[slug], recipe edit, PDF import draft,
// ingredient-review convert) — rendered inside the root layout, so the
// header/nav above this is already there for free.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <CookingPot size={40} className="text-emerald-600" />
      <h1 className="mt-4 text-3xl font-semibold text-zinc-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Whatever you were looking for isn&apos;t here — maybe it moved, or the link&apos;s
        stale.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
      >
        Back to recipes
      </Link>
    </main>
  );
}
