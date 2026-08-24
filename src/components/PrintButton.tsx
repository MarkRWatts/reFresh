"use client";

import { Printer } from "lucide-react";

export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400"
    >
      <Printer className="h-4 w-4" /> {label}
    </button>
  );
}
