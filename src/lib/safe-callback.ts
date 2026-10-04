/** Only ever a same-origin app path (e.g. an invite link) — never an
 *  absolute URL, so a crafted ?callbackURL= value can't become an open
 *  redirect. Shared by /signin and its sign-in actions. */
export function safeCallbackURL(raw: string | null | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  return "/";
}
