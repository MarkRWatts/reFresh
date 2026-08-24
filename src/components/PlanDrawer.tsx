"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

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
        className="ml-auto flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        This week
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs">
          {count}
        </span>
      </button>

      {isOpen &&
        createPortal(
          // Portalled to <body> rather than rendered in place — the trigger
          // button lives in the header, which has backdrop-blur, and any
          // ancestor with a backdrop-filter/filter/transform becomes the
          // containing block for `fixed` descendants. Left in place, this
          // overlay would be confined to the header's own box instead of
          // covering the viewport.
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
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
