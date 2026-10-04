// Best-effort client IP for the app's own throttles (src/lib/throttle.ts)
// in the sign-in actions. Ported from MediaVault.
//
// Behind Cloudflare Tunnel the trustworthy value is `cf-connecting-ip`,
// which the edge sets and a client cannot override. `x-forwarded-for` is
// the fallback for the LAN/Caddy path; only a single-valued header is
// trusted there (a client can prepend its own entries, and a proxy appends
// the real one, so a multi-valued XFF is ambiguous). Anything else — no
// header at all, an unparsable value — yields null, and callers key their
// throttle on a shared "unknown" bucket rather than skipping it. Mirrors
// the header order given to Better Auth in src/auth.ts.

const IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)$/i;

export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf && IP_RE.test(cf)) return cf;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1 && IP_RE.test(parts[0])) return parts[0];
  }
  return null;
}
