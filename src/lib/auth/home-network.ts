// Whether a request reached re:Fresh from the home network, which decides
// whether /signin offers "Sign in with Pocket ID": Pocket ID
// (id.markrwatts.com) only answers on the LAN and VPN, so from anywhere else
// the button would send the browser somewhere that never loads.
//
// How requests arrive (ansible-homelab: roles/tunnel, roles/edge, and the
// Pi-hole split-DNS entry for refresh.markrwatts.com):
//
//   internet: browser -> Cloudflare edge (+ Access) -> cloudflared on
//             tunnel-vm -> Caddy on refresh-vm -> app
//   LAN/VPN:  browser -> (split DNS) -> Caddy on refresh-vm -> app
//
// Cloudflare stamps every request it proxies with `cf-connecting-ip` (the
// visitor's IP), cloudflared passes it through, and Caddy's reverse_proxy
// forwards request headers unchanged, so it reaches the app on the internet
// path and never on the LAN path. A visitor can't remove it (Cloudflare sets
// it at the edge); a LAN client could add it, which only hides the button
// from themselves. So this is a convenience, not a security boundary: who
// gets in through Pocket ID is decided by the group check in src/auth.ts.

type HeaderSource = { get(name: string): string | null };

export function isHomeNetworkRequest(headers: HeaderSource): boolean {
  return !headers.get("cf-connecting-ip");
}
