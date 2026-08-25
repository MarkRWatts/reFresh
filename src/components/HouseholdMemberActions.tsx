"use client";

import { useActionState, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import {
  createInvitation,
  cancelInvitation,
  promoteToOwner,
  demoteToMember,
  removeMember,
  type ActionState,
} from "@/app/actions/household";

function ActionButton({
  action,
  fieldName,
  fieldValue,
  label,
  pendingLabel,
  danger = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fieldName: string;
  fieldValue: string;
  label: string;
  pendingLabel: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name={fieldName} value={fieldValue} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-60 ${
          danger
            ? "border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50"
            : "border-zinc-300 text-zinc-600 hover:border-zinc-400"
        }`}
      >
        {pending ? pendingLabel : label}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function PromoteButton({ memberId }: { memberId: string }) {
  return (
    <ActionButton
      action={promoteToOwner}
      fieldName="memberId"
      fieldValue={memberId}
      label="Make owner"
      pendingLabel="Promoting…"
    />
  );
}

export function DemoteButton({ memberId }: { memberId: string }) {
  return (
    <ActionButton
      action={demoteToMember}
      fieldName="memberId"
      fieldValue={memberId}
      label="Make member"
      pendingLabel="Demoting…"
    />
  );
}

export function RemoveMemberButton({ memberId }: { memberId: string }) {
  return (
    <ActionButton
      action={removeMember}
      fieldName="memberId"
      fieldValue={memberId}
      label="Remove"
      pendingLabel="Removing…"
      danger
    />
  );
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Copy-the-link + cancel for one pending household invite. The link
 *  (`/invite/<id>`) is also emailed to the invitee (auth.ts's
 *  sendInvitationEmail), but `Invitation.email` remains a hint, not an
 *  authorization check — redemption is token-only (see acceptInvitation). */
export function PendingInviteRow({
  id,
  email,
  expiresAt,
}: {
  id: string;
  email: string;
  expiresAt: string;
}) {
  const [state, formAction, pending] = useActionState(cancelInvitation, null);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const url = `${window.location.origin}/invite/${id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2 border-b border-zinc-200 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-zinc-900">{email}</span>
        <span className="text-xs text-zinc-400">Expires {formatExpiry(expiresAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-full border border-emerald-600 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <form action={formAction}>
          <input type="hidden" name="invitationId" value={id} />
          <button
            type="submit"
            disabled={pending}
            title="Cancel invite"
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </div>
  );
}

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInvitation, null);
  const [appOnly, setAppOnly] = useState(false);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="them@example.com"
          className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-full border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Invite"}
        </button>
      </div>
      <label className="flex items-start gap-2 text-sm text-zinc-600">
        <input
          type="checkbox"
          name="appOnly"
          checked={appOnly}
          onChange={(e) => setAppOnly(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-emerald-600"
        />
        <span>
          Invite to re:Fresh only — they&apos;ll set up their own household and won&apos;t see
          yours.
        </span>
      </label>
      {state?.sent && (
        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          Invite sent to {state.sent}
        </span>
      )}
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
