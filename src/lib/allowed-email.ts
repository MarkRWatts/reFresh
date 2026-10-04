// Comma-separated, case-insensitive email allowlist — the app-level half of
// the belt-and-braces gate described in DEPLOYMENT.md's "Going public"
// section (Cloudflare Access is the other half, on the external path only).
// Ported from jinglejotter.com's auth.ts with one deliberate difference:
// there an empty list means nobody signs in; here empty/unset means the gate
// is OFF, so local dev and a LAN-only deployment work without the var and
// enforcement starts only when .env.docker sets it.
//
// Enforced in two places (see src/auth.ts): the session-create hook refuses
// a session for every sign-in method (email code, passkey, Pocket ID), and
// src/lib/otp-email.ts silently doesn't email a code to an address this
// refuses.

type Env = Record<string, string | undefined>;

export function isAllowedEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const allowed = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
