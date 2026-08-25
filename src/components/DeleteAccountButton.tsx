"use client";

import { useActionState, useState } from "react";
import { Trash2, X } from "lucide-react";
import { deleteAccount } from "@/app/actions/account";

const CONFIRM_WORD = "DELETE";

/** A household's only owner gets a second, stronger confirmation — typing
 *  the household's exact name — since deleting their account in that case
 *  takes the whole household with it, not just their own access. */
export default function DeleteAccountButton({
  householdName,
  soleOwner,
  otherMemberCount,
}: {
  householdName: string | null;
  soleOwner: boolean;
  otherMemberCount: number;
}) {
  const [state, formAction, pending] = useActionState(deleteAccount, null);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [confirmName, setConfirmName] = useState("");

  function close() {
    setOpen(false);
    setConfirmText("");
    setConfirmName("");
  }

  const ready = confirmText === CONFIRM_WORD && (!soleOwner || confirmName === householdName);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-semibold text-red-600 transition hover:text-red-700"
      >
        <Trash2 className="h-4 w-4" />
        Delete account
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-heading"
          onClick={close}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4 backdrop-blur-[2px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="delete-account-heading" className="text-lg font-semibold text-zinc-900">
                Delete your account?
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Cancel"
                className="shrink-0 text-zinc-400 transition hover:text-zinc-600"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {soleOwner ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                You&apos;re the only owner of &ldquo;{householdName}&rdquo;. Deleting your
                account deletes the <strong>entire household</strong> — every favourite, hidden
                recipe, and this week&apos;s plan
                {otherMemberCount > 0 ? ", for everyone in it" : ""} — for good. If you&apos;d
                rather keep it going, cancel and promote another member to owner first.
              </p>
            ) : (
              <p className="text-sm text-zinc-500">
                {householdName
                  ? `You'll lose access to ${householdName}, but nothing you've added — favourites, hidden recipes, this week's plan — is deleted.`
                  : "This permanently deletes your account."}{" "}
                This can&apos;t be undone.
              </p>
            )}

            <form action={formAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-zinc-500">
                  Type {CONFIRM_WORD} to confirm
                </span>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  className="rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-600"
                />
              </label>

              {soleOwner && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-500">
                    Type &ldquo;{householdName}&rdquo; to confirm deleting the household
                  </span>
                  <input
                    type="text"
                    name="confirmHouseholdName"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoComplete="off"
                    className="rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-600"
                  />
                </label>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!ready || pending}
                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete account
                </button>
              </div>
              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
