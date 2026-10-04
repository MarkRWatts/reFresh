// Cookie names for the email-code sign-in flow (app/actions/auth-flow.ts).
// In a module of their own because "use server" files may only export async
// functions, and /signin reads these too.

/** The email a code was just requested for, between /signin's two steps:
 *  in an httpOnly cookie rather than a query param, so no address ever
 *  lands in a URL (or a proxy log). */
export const OTP_EMAIL_COOKIE = "refresh-otp-email";
/** The name typed on step 1, used only if this email has no account yet. */
export const OTP_NAME_COOKIE = "refresh-otp-name";
