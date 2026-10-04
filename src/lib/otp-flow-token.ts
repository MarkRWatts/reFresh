// The value of the `refresh-otp-email` flow cookie (src/lib/flow-cookies.ts): the
// address a sign-in code was sent to, plus a random flow id, HMAC-signed with
// the same AUTH_SECRET that signs the session cookie. Ported from MediaVault.
//
// Why it is signed: verifyOTP used to trust a bare email in this cookie, so
// anyone could set it to a victim's address and submit junk codes — burning
// the emailOTP plugin's 3 attempts (which then deletes the victim's live
// code) and the per-email check budget. Signed, the cookie can only be the
// one this server issued to *this* browser after a requestOTP, so
// guesses can't be fired at an address the browser never asked a code for.
// The flow id is what the check throttle keys on, so a stranger's guesses
// never spend the real owner's budget either.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface OtpFlow {
  email: string;
  /** Random per code request; keys the verify-attempt throttle. */
  flowId: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`otp-flow:${payload}`).digest("base64url");
}

/** Mint a cookie value for `email` with a fresh flow id. */
export function signOtpFlow(email: string, secret: string | undefined = process.env.AUTH_SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const payload = `${randomBytes(12).toString("base64url")}.${Buffer.from(email).toString("base64url")}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The flow a cookie value carries, or null if it is missing, malformed or
 *  not signed by this server. */
export function verifyOtpFlow(
  raw: string | null | undefined,
  secret: string | undefined = process.env.AUTH_SECRET,
): OtpFlow | null {
  if (!raw || !secret) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [flowId, emailPart, signature] = parts;
  const expected = sign(`${flowId}.${emailPart}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const email = Buffer.from(emailPart, "base64url").toString();
  return email ? { email, flowId } : null;
}
