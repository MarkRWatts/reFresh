// The sign-in code email: six digits, valid for 10 minutes (src/auth.ts's
// emailOTP plugin). Codes rather than the old magic links because an
// installed iOS home-screen app has its own cookie jar, separate from
// Safari's: a link tapped in Mail signs Safari in, not the app. A code typed
// in place signs in wherever it's typed. Same reasoning as MediaVault and
// jinglejotter.com.
//
// Gated by ALLOWED_EMAILS (src/lib/allowed-email.ts): an address the gate
// would refuse silently gets nothing, so a stranger who types some other
// address into the sign-in form never learns this app exists or that they
// were rejected, and never consumes Resend quota. The authoritative refusal
// is still src/auth.ts's session-create hook.
//
// The send runs detached from the request (sendSignInOTP below): awaiting it
// would make an allowed address take a Resend round trip longer to answer
// than a refused one, which is a measurable "is this email known?" oracle.
// The sign-in page says "check your email" either way and offers a resend.

import { isAllowedEmail } from "@/lib/allowed-email";
import { appBaseUrl, codeChipHtml, renderBrandedEmail, sendEmail } from "@/lib/email";

type OTPRequest = { email: string; otp: string; type: string };

/** Sends the code email, or nothing for a refused address or a non-sign-in
 *  OTP type. Awaitable, for tests; the plugin calls sendSignInOTP. */
export async function deliverSignInOTP({ email, otp, type }: OTPRequest): Promise<boolean> {
  // Sign-in is the only OTP flow this app uses (no passwords to reset, no
  // email-change flow): anything else is a no-op rather than a surprise.
  if (type !== "sign-in") return false;
  if (!isAllowedEmail(email)) return false;

  const intro = "Enter this code on the re:Fresh sign-in page. It expires in 10 minutes.";
  const { html, text } = renderBrandedEmail({
    heading: "Your sign-in code",
    // `otp` is app-generated digits: no user content is interpolated.
    bodyHtml: `<p style="margin:0;">${intro}</p>${codeChipHtml(otp)}`,
    bodyText: `${intro}\n\nYour code: ${otp}`,
    ctaLabel: "Open re:Fresh",
    ctaUrl: `${appBaseUrl()}/signin`,
  });
  await sendEmail({ to: email, subject: `${otp} is your re:Fresh sign-in code`, html, text });
  return true;
}

/** emailOTP's sendVerificationOTP: returns as soon as the plugin has stored
 *  the code, whatever happens to the email. */
export async function sendSignInOTP(data: OTPRequest): Promise<void> {
  void deliverSignInOTP(data).catch((err) => {
    // Never the code or the address in the log line: just that a send failed.
    console.error("[otp-email] sign-in code email failed:", err instanceof Error ? err.message : err);
  });
}
