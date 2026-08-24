"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Debounced search box for the ingredient review page — same 350ms-debounce-then-navigate pattern as FilterBar's recipe search, kept separate since this page's URL params (q/page only) aren't shaped like ParsedFilters. */
export default function IngredientReviewSearch({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialValue);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      const params = new URLSearchParams();
      if (value) params.set("q", value);
      router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
    }, 350);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search ingredients..."
      className="w-full rounded-full border border-zinc-300 px-4 py-1.5 text-base sm:w-72 sm:text-sm"
    />
  );
}
