// A starting suggestion for a new passkey's name on /account, from the
// browser's user-agent. A suggestion, not a fact — the field stays editable
// — so deliberately coarse. It exists because the plugin's AAGUID-based
// label (getAuthenticatorName) returns nothing for most Apple passkeys:
// Apple zeroes the AAGUID under the `attestation: "none"` flow the plugin
// uses. iPadOS reports a "Macintosh" user-agent, so an iPad suggests "Mac".
// Same helper as jinglejotter.com's lib/passkey-label.ts.

/** Server-enforced bound on a passkey's name (app/actions/passkeys.ts); the
 *  client maxLength mirrors it. Lives here because "use server" modules may
 *  only export async functions. */
export const PASSKEY_NAME_MAX_LENGTH = 64;

export function suggestPasskeyName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  // Android before Linux: Android user-agents contain "Linux" too.
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux";
  return "This device";
}
