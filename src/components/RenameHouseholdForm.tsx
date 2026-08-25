"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { updateHouseholdName, type ActionState } from "@/app/actions/household";

/** Household name heading with an inline edit affordance. Only rendered
 *  editable for the owner (see account/page.tsx) — the server action
 *  itself is also owner-only, this just avoids showing an edit control
 *  that would only ever fail for a plain member. */
export default function RenameHouseholdForm({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateHouseholdName,
    null,
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) setEditing(false);
    wasPending.current = pending;
  }, [pending, state]);

  if (!editing) {
    return (
      <div className="group flex items-center gap-1.5">
        <h2 className="text-xl font-semibold text-zinc-900">{name}</h2>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename household"
          className="text-zinc-300 transition hover:text-emerald-600 group-hover:text-zinc-400"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Rename household</span>
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        name="name"
        defaultValue={name}
        autoFocus
        required
        maxLength={60}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-emerald-600"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-emerald-600 bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 transition hover:bg-zinc-100"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
