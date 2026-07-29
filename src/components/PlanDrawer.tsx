"use client";

import { useState } from "react";

export default function PlanDrawer({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white shadow-lg hover:bg-zinc-800"
      >
        This week
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs">
          {count}
        </span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-900">This week</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
