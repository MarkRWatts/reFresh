"use client";

import { useActionState } from "react";
import { verifyOTP, type ActionState } from "@/app/actions/auth-flow";

/** /signin step 2: type the six digits from the email.
 *  autoComplete="one-time-code" lets iOS offer the code straight from Mail —
 *  the whole reason for typed codes over clickable links (an installed
 *  home-screen app has its own cookie jar; a link tapped in Mail would sign
 *  in Safari instead). */
export function OTPForm({ callbackURL = "/" }: { callbackURL?: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(verifyOTP, null);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <input type="hidden" name="callbackURL" value={callbackURL} />
      <input
        type="text"
        name="otp"
        required
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
        placeholder="123456"
        aria-label="Sign-in code"
        className="w-full rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-center text-lg tracking-[0.5em] text-zinc-900 placeholder:text-zinc-300 focus:border-emerald-600 focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600 bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
      {state?.error && <p className="text-sm text-amber-800">{state.error}</p>}
    </form>
  );
}
