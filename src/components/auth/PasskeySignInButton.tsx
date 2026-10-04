"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { usePasskeySupport } from "@/lib/use-passkey-support";

/** "Sign in with a passkey" on /signin, plus the browser's conditional-UI
 *  autofill: where supported, the passkey is offered inside the email
 *  field's own autofill sheet (the field carries
 *  autoComplete="username webauthn"), so the common path is one tap with no
 *  button at all. The button is the fallback for browsers without
 *  conditional mediation and for people who dismissed the sheet. Same as
 *  jinglejotter.com's.
 *
 *  Client-side by necessity — the WebAuthn ceremony is a browser API — so
 *  this talks to /api/auth/passkey/* through authClient. The session cookie
 *  is set by that response; router.refresh() afterwards is what makes every
 *  getSession()-reading server component see it.
 *
 *  `callbackURL` has already been through safeCallbackURL on the server
 *  page — this never redirects anywhere the page didn't validate. */
export function PasskeySignInButton({ callbackURL }: { callbackURL: string }) {
  const router = useRouter();
  // "unknown" on the server and during hydration, so SSR renders nothing
  // and the button appears (or not) on the first client render.
  const supported = usePasskeySupport() === "yes";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Autofill and the button can both succeed for one page — never navigate twice.
  const navigated = useRef(false);

  const finish = useCallback(() => {
    if (navigated.current) return;
    navigated.current = true;
    // Stays pending for good: the page is navigating away.
    setPending(true);
    router.push(callbackURL);
    router.refresh();
  }, [router, callbackURL]);

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;
    (async () => {
      const conditional = await window.PublicKeyCredential.isConditionalMediationAvailable?.().catch(
        () => false,
      );
      if (!conditional || cancelled) return;
      // Resolves only when the person picks a passkey from the autofill
      // sheet. Errors are deliberately silent: this pending ceremony is
      // aborted whenever the button's own ceremony starts, or the page
      // navigates away, and neither is worth telling anyone about.
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (cancelled || result.error) return;
      finish();
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, finish]);

  async function signIn() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    setPending(false);
    if (result.error) {
      setError(describe(result.error));
      return;
    }
    finish();
  }

  if (!supported) return null;

  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-600 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
      >
        <KeyRound size={16} aria-hidden />
        {pending ? "Waiting for your device…" : "Sign in with a passkey"}
      </button>
      {error && <p className="text-sm text-amber-800">{error}</p>}
    </div>
  );
}

/** Few user-facing outcomes on purpose: nothing here distinguishes "no such
 *  passkey" from "passkey fine but ALLOWED_EMAILS refused the session". */
function describe(error: { code?: string; status: number }): string | null {
  const code = error.code ?? "";
  // They dismissed the browser's prompt (or another ceremony aborted this one).
  if (code === "AUTH_CANCELLED" || code === "ERROR_CEREMONY_ABORTED") return null;
  if (code === "PASSKEY_NOT_FOUND" || code === "AUTHENTICATION_FAILED") {
    return "That passkey isn't set up for re:Fresh — use an email code instead.";
  }
  return "Couldn't sign you in with that passkey — use an email code instead.";
}
