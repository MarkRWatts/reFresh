"use server";

// /signin's server-side sign-in steps (see src/auth.ts for the methods):
//
//   requestOTP:         step 1 — email (and a name, for a brand-new
//                       account) in, six-digit code emailed out
//   verifyOTP:          step 2 — the code, typed in place
//   signInWithPocketId: the home-network-only Pocket ID button
//
// Passkey sign-in isn't here: the WebAuthn ceremony is a browser API, so it
// runs client-side (components/auth/PasskeySignInButton.tsx).
//
// The email between steps 1 and 2 rides in a short-lived httpOnly cookie,
// not a query param, so no address lands in a URL.

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { POCKET_ID_PROVIDER_ID } from "@/lib/auth/pocket-id";
import { OTP_EMAIL_COOKIE, OTP_NAME_COOKIE } from "@/lib/flow-cookies";
import { safeCallbackURL } from "@/lib/safe-callback";
import { MAX_TEXT_LENGTH, isTooLong } from "@/lib/validation";

export type ActionState = { error?: string } | null;

const FLOW_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 10, // the code's own lifetime
} as const;

/** Step 1, and step 2's "resend the code". Always lands on the enter-the-code
 *  step whether or not an email was actually sent: src/lib/otp-email.ts
 *  silently skips addresses ALLOWED_EMAILS refuses, and saying so here would
 *  let anyone probe which emails this app knows. */
export async function requestOTP(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const callbackURL = safeCallbackURL(String(formData.get("callbackURL") ?? ""));
  const params = `&callbackURL=${encodeURIComponent(callbackURL)}`;
  if (!email) redirect(`/signin?error=MissingEmail${params}`);
  if (isTooLong(email) || !email.includes("@")) redirect(`/signin?error=BadEmail${params}`);

  try {
    await auth.api.sendVerificationOTP({
      body: { email, type: "sign-in" },
      headers: await headers(),
    });
  } catch {
    redirect(`/signin?error=SendFailed${params}`);
  }

  const store = await cookies();
  store.set(OTP_EMAIL_COOKIE, email, FLOW_COOKIE_OPTS);
  // The resend button posts no name; keep the one typed on step 1.
  if (name) store.set(OTP_NAME_COOKIE, name.slice(0, MAX_TEXT_LENGTH), FLOW_COOKIE_OPTS);
  redirect(`/signin?otp=1${params}`);
}

/** Step 2: the emailed six digits. On success Better Auth sets the session
 *  cookie (nextCookies plugin), after the ALLOWED_EMAILS session hook. */
export async function verifyOTP(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const store = await cookies();
  const email = store.get(OTP_EMAIL_COOKIE)?.value;
  const callbackURL = safeCallbackURL(String(formData.get("callbackURL") ?? ""));
  // Flow state expired (10 min) or cookies cleared: start over.
  if (!email) redirect(`/signin?callbackURL=${encodeURIComponent(callbackURL)}`);

  const otp = String(formData.get("otp") ?? "").trim();
  if (!otp) return { error: "Enter the code from your email." };
  const name = store.get(OTP_NAME_COOKIE)?.value;

  try {
    await auth.api.signInEmailOTP({
      // name only applies when this email has no account yet — an existing
      // user's name is never touched by it.
      body: { email, otp, name: name || undefined },
      headers: await headers(),
    });
  } catch {
    // Wrong, expired, too many attempts, refused by ALLOWED_EMAILS, or (for
    // an address that was never actually emailed) no code at all — one
    // message for all of them.
    return { error: "That code didn't work — check it, or send a fresh one." };
  }

  store.delete(OTP_EMAIL_COOKIE);
  store.delete(OTP_NAME_COOKIE);
  redirect(callbackURL);
}

/** "Sign in with Pocket ID": off to id.markrwatts.com, back through
 *  /api/auth/callback/pocket-id. A refusal there (not in the `refresh`
 *  group, or ALLOWED_EMAILS) comes back as /signin?error=<code>. */
export async function signInWithPocketId(formData: FormData): Promise<void> {
  const callbackURL = safeCallbackURL(String(formData.get("callbackURL") ?? ""));
  let url: string | undefined;
  try {
    // Unlike Auth.js's signIn(), this only returns the provider's URL; the
    // redirect is a separate step. genericOAuth providers go through the
    // social sign-in endpoint.
    ({ url } = await auth.api.signInSocial({
      body: { provider: POCKET_ID_PROVIDER_ID, callbackURL, errorCallbackURL: "/signin" },
      headers: await headers(),
    }));
  } catch {
    // Not configured here, or Pocket ID's discovery document unreachable.
  }
  redirect(url ?? `/signin?error=PocketIdUnavailable&callbackURL=${encodeURIComponent(callbackURL)}`);
}
