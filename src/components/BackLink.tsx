"use client";

import { useRouter } from "next/navigation";

/**
 * A "back to recipes" link that returns to wherever the user actually came
 * from (browser history), preserving whatever filters/search/page were
 * active — a plain `<Link href="/">` always reset them. Falls back to a
 * fresh "/" navigation if there's no history to go back to (e.g. this page
 * was opened directly, such as a bookmarked or shared recipe URL).
 */
export default function BackLink({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push("/");
        }
      }}
      className={className}
    >
      ← Back to recipes
    </button>
  );
}
