"use client";

import { useState } from "react";

/**
 * Copies plain text built server-side rather than letting the browser
 * serialize the on-screen list — selecting text out of the flex-laid-out
 * rows produces no space between the ingredient name and its quantity
 * (the gap between them is layout, not a text character).
 */
type Status = "idle" | "copied" | "failed";

export default function CopyListButton({ text, label = "Copy list" }: { text: string; label?: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 hover:border-zinc-400"
    >
      {status === "copied" ? "✓ Copied" : status === "failed" ? "Couldn't copy" : `📋 ${label}`}
    </button>
  );
}
