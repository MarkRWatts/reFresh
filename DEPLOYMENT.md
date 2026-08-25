# VM deployment (TrueNAS)

> **Placeholders, deliberately.** Hostnames, IPs, account/team names, and guest emails in this doc are genericized (`refresh.example.com`, `<vm-ip>`, …). The real values live in the private Confluence space **reFresh** → "Deployment — concrete values & sensitive notes".

This documents how the app was moved from the Mac to its production home — the same Ubuntu Server VM on TrueNAS that [jobAppTracker](https://github.com/MarkRWatts/jobAppTracker) runs on, behind a **shared** Caddy reverse proxy. See [jobAppTracker's `DEPLOYMENT.md`](https://github.com/MarkRWatts/jobAppTracker/blob/main/DEPLOYMENT.md) for the base OS setup and the shared Caddy stack itself (`~/edge`) — this doc only covers what's specific to reFresh.

**Live at**: `https://refresh.example.com` — LAN-only (no port-forwarding), real Let's Encrypt certificate. Going public is planned — see [Going public](#going-public-cloudflare-tunnel--access--pi-hole-split-dns) for the runbook. Multi-household auth (Google + magic-link, via Better Auth) as of Phase 16 — see [Multi-household auth](#multi-household-auth-phase-16) below for the Google/Resend setup and the one-time schema migration + backfill this needed. Sign-in happens over the browser reaching `https://refresh.example.com` directly, so it works fine LAN-only as long as that's true when someone signs in (true for this household in practice).

## 1. Prerequisites already in place

The VM already has Docker, ufw, and `dnsutils` installed (from setting up jobAppTracker first), and the shared `~/edge` Caddy stack already exists — adding this app means adding a site block there, not standing up a new proxy.

## 2. Get the code

```bash
git clone https://github.com/MarkRWatts/reFresh.git ~/reFresh
```
(HTTPS, not this repo's configured SSH remote — no need to put a real SSH key on the VM for a public repo.)

## 3. `docker-compose.override.yml` / `docker-compose.prod.yml`

Mirrors the split jobAppTracker uses. The base `docker-compose.yml`'s `app` service no longer publishes port 3000 directly:
- [`docker-compose.override.yml`](docker-compose.override.yml) — moves that `ports: ["3000:3000"]` back, auto-loaded only when no `-f` flags are given (i.e. the Mac's local/dev workflow), so nothing changes there.
- [`docker-compose.prod.yml`](docker-compose.prod.yml) — the VM-only overlay. Joins `app` to the external `edge` network under the alias `refresh`, so the shared Caddy can reach it as `refresh:3000`. No auth vars to add here (unlike jobAppTracker) — this file is deliberately small.

## 4. DNS + acme-dns

Own acme-dns registration (kept separate from jobAppTracker's, to avoid a renewal race between apps sharing one account):

```bash
curl -X POST https://auth.acme-dns.io/register
```

Two DNS records added at Easyspace:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | `_acme-challenge.refresh` | `<fulldomain from registration>` |
| A | `refresh` | `<VM's LAN IP>` |

Then a site block for `refresh.example.com` was added to `~/edge/Caddyfile` and its acme-dns credentials to `~/edge/.env` — see jobAppTracker's `DEPLOYMENT.md` for the shared Caddyfile's exact shape.

## 5. `.env.docker`

Created directly on the server (never committed — see `.env.docker.example`). `POSTGRES_USER` / `POSTGRES_PASSWORD` (rotated fresh) / `POSTGRES_DB`, plus (as of Phase 16) the `AUTH_*`/`RESEND_API_KEY` vars for multi-household sign-in — see [Multi-household auth](#multi-household-auth-phase-16). HTTPS itself still has nothing to add here — that lives in `~/edge`.

## 6. Data migration (Mac → VM)

Three named volumes exist (`pgdata`, `scraper-cache`, `db-backups`); only `pgdata` (the live database) and `db-backups` (historical `npm run db:snapshot` output) were carried over. `scraper-cache` is pure HTML cache and was skipped — it regenerates on the next scrape.

On the Mac:
```bash
docker exec refresh-db-1 pg_dump -U refresh -Fc refresh > refresh.dump
docker run --rm -v refresh_db-backups:/data -v "$PWD":/backup alpine tar czf /backup/db-backups.tar.gz -C /data .
scp refresh.dump db-backups.tar.gz deploy@<vm-ip>:~/
```

On the VM (after `docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml up -d db`, before starting `app`):
```bash
docker exec -i refresh-db-1 pg_restore -U refresh -d refresh --no-owner --no-privileges < ~/refresh.dump
docker volume create refresh_db-backups
docker run --rm -v refresh_db-backups:/data -v "$HOME":/backup alpine tar xzf /backup/db-backups.tar.gz -C /data
rm -f ~/refresh.dump ~/db-backups.tar.gz
```

## 7. Bring up

```bash
cd ~/reFresh
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml up -d --build
cd ~/edge && docker compose up -d --build   # picks up the new site block + issues its cert
```

## 8. Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://refresh.example.com/   # 200, valid cert
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml logs app   # "No pending migrations to apply"
```
Then open it in a browser and confirm the recipe count and meal plan match what was on the Mac (compare `SELECT COUNT(*) FROM "Recipe";` via `docker exec ... psql` on both if in doubt — the homepage's displayed count is a filtered view, not the raw table total).

## 9. Cutover

Once verified, the Mac's containers were stopped (not removed, for an easy rollback):
```bash
docker stop refresh-app-1 refresh-db-1
```
`docker start refresh-app-1 refresh-db-1` brings the old Mac instance straight back if ever needed.

## Updating the deployment

```bash
ssh deploy@<vm-ip>
cd ~/reFresh
git pull
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Multi-household auth (Phase 16)

Adds Google + magic-link sign-in (Better Auth) and per-household favourites/hidden/this-week state, replacing the single-user/no-auth design above — see `prisma/schema.prisma` and `project-plan.md`'s Phase 16 entry for the data model. This section covers what's specific to standing that up in production; it assumes the app is already deployed per sections 1–9 above.

### 1. Google OAuth client

Google Cloud Console → APIs & Services → Credentials → create an OAuth client (type: Web application), separate from any other app's client (jobAppTracker, jinglejotter.com) so the credentials stay independent. Authorized redirect URI: `https://refresh.example.com/api/auth/callback/google`. Note the client ID/secret for `.env.docker` below.

### 2. Resend domain verification

`refresh.example.com` verified in Resend for the `noreply@refresh.example.com` sending address (see `src/lib/email.ts`) — SPF/DKIM records added via Cloudflare, plus a DMARC record (`_dmarc.refresh` TXT `v=DMARC1; p=none;`, TTL Auto) on the apex zone. Note the Resend API key for `.env.docker` below.

### 3. `.env.docker` additions

Add to the VM's `.env.docker` (see `.env.docker.example` for the full set): `AUTH_SECRET` (generate with `openssl rand -base64 32`), `AUTH_URL=https://refresh.example.com`, `AUTH_TRUSTED_ORIGINS=https://refresh.example.com`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (from step 1), `RESEND_API_KEY` (from step 2).

### 4. Schema migration + backfill

Real favourite/hidden/this-week data already exists in production under the old single-user schema (`Recipe.isFavourite`/`isHidden`/`lastSuggestedAt`, one implicit `MealPlan`) and needs to land in a household rather than being lost. Run in this exact order — the migrations are split specifically so the backfill has a window to run in between:

```bash
ssh deploy@<vm-ip>
cd ~/reFresh
git pull
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml up -d --build   # picks up the new env vars and code

# 1. Apply the additive migration only (new auth/household tables, MealPlan.householdId still nullable)
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

Then, in a real browser, sign in once as each real household member (Google or magic-link) at `https://refresh.example.com/signin` — this just needs a `User` row to exist for each, no household yet. Both land on `/onboarding`, which is expected; ignore it for now.

```bash
# 2. Backfill: creates the household, attaches both members, migrates
#    existing favourite/hidden/this-week data into it
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml exec app \
  npx tsx scripts/backfill-household.ts "<household name>" owner@example.com partner@example.com

# 3. Apply the final migration (MealPlan.householdId required; drops the old Recipe columns)
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

### 5. Verify

Sign in as both household members again — same recipe catalog and count as before, existing favourites/hidden recipes/this-week plan all present for both (not duplicated, not lost). `/account` shows the household with both as members. A third sign-in (anyone else) lands on `/onboarding` and can start its own household against the same shared catalog, seeing none of the first household's favourites/hidden/plan state.

## Going public (Cloudflare Tunnel + Access + Pi-hole split DNS)

Runbook for opening `https://refresh.example.com` to invited friends/family on the internet. No port-forwarding, and the home IP never appears in DNS. **Applied 2026-08-25** — see [As applied](#as-applied-2026-08-25) below for the deltas between this plan and what the dashboard actually looks like now.

The shape: externally, a **Cloudflare Tunnel** carries traffic from Cloudflare's edge to the VM over an outbound-only connection, with **Cloudflare Access** (an email allowlist, free tier covers 50 users) gating it before a request ever reaches the VM. Internally, the **Pi-hole** answers `refresh.example.com` with the VM's LAN IP, so LAN clients keep hitting the shared Caddy directly — same URL, same real Let's Encrypt certificate on both paths (Caddy's cert comes via DNS-01/acme-dns, which doesn't care where the public record points, so the LAN path stays warning-free). App-level auth (Better Auth) is unchanged and applies on both paths; Access is an extra outer gate on the external path only.

### Why a separate tunnel (not another app's)

One cloudflared tunnel *can* route any number of hostnames across every zone in the same Cloudflare account, so sharing an existing tunnel is technically possible. It's still the wrong move when that tunnel belongs to another app's own compose stack: it sits on that stack's network, shares that stack's lifecycle (teardowns, rebuilds, possible re-homing to other hardware), and anything piggybacking on it loses its ingress the day that stack moves. Tunnels are free and unlimited, so separation costs nothing.

Instead, follow the house pattern: a tunnel that fronts apps on this VM is shared infrastructure, so **it lives in `~/edge`** alongside Caddy, owned by no single app's repo. A future app going public just adds a public hostname to *this* tunnel.

### 1. Create the tunnel

Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create tunnel → Cloudflared connector. Name it for the VM, not the app (e.g. `home-edge`), since it may carry more apps later. Copy the connector token into `~/edge/.env` as `TUNNEL_TOKEN` (never committed, same as the acme-dns credentials).

Add the connector to `~/edge/docker-compose.yml`, joining the same external `edge` network the apps are on (mirror the `caddy` service's `networks:` stanza):

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run --token ${TUNNEL_TOKEN}
    networks:
      - edge
```

Then `cd ~/edge && docker compose up -d` and confirm the tunnel shows **Healthy** in the dashboard.

### 2. Route the hostname through it

In the tunnel's **Public hostnames** tab: add `refresh.example.com` → service `http://refresh:3000`. The connector is on the `edge` network, so it reaches the app by the same alias Caddy does.

Two DNS notes (apex zone, Cloudflare):

- The dashboard creates a **proxied CNAME** for `refresh` pointing at the tunnel — the existing grey-cloud `A refresh → <VM LAN IP>` record must be deleted first (the dashboard will refuse or prompt otherwise).
- **Keep `CNAME _acme-challenge.refresh`** (the acme-dns delegation). Caddy's LAN-path certificate renewal depends on it.

Why point the tunnel at `refresh:3000` rather than at Caddy: Caddy's only job in this stack is TLS termination, and the tunnel provides its own TLS on the external leg — routing tunnel → Caddy would add per-hostname origin-TLS/SNI config for no gain. Caddy still serves the LAN path exactly as before; its site block is untouched.

### 3. Cloudflare Access (the account gate)

Zero Trust → Access → Applications → Add an application → Self-hosted:

- **Domain**: `refresh.example.com` (the whole site — no bypass paths needed; see interplay notes below).
- **Policy**: Allow, Include → Emails → the invited list. Make a **reFresh-specific policy** — don't reuse another app's reusable policy; the lists will evolve independently.
- **Login methods**: One-time PIN covers everyone with an email address. Optionally also add Google as an Access identity provider so Google-account users get one-click instead of a PIN.
- **Session duration**: something long (e.g. 1 month) — the app's own Better Auth session is 30 days; matching keeps the outer gate from re-prompting more often than the app does.

Interplay with app auth (verified shapes, no exceptions needed):

- The Google OAuth callback (`/api/auth/callback/google`) and magic-link verify URLs are only ever opened by a browser that has already passed Access, so nothing needs excluding from the policy.
- A magic-link user on a fresh device does two email round-trips: Access's OTP, then the app's magic link. Mildly clunky but correct — using the same email for both keeps it painless.
- The app enforces its own `ALLOWED_EMAILS` allowlist as a second layer — see the next section.

### 3b. App-level allowlist (`ALLOWED_EMAILS`)

Belt and braces: the same email list is enforced *inside* the app too (ported from jinglejotter.com's `app/auth.ts` — a `databaseHooks.session.create.before` hook in `src/auth.ts` that rejects session creation for any email not on the list, regardless of auth method, plus a silent no-op in `sendMagicLinkEmail` so strangers never receive email or learn the app exists). This covers what Access can't: the LAN path (Wi-Fi guests, split-DNS clients) and any future misconfiguration of the tunnel or Access policy.

One deliberate difference from jinglejotter.com's version: **empty/unset = gate OFF** (anyone may sign in), so local dev and the LAN-only deployment work without the var. That makes setting it a required go-public step:

- Add to the VM's `.env.docker` (see `.env.docker.example`): `ALLOWED_EMAILS=<comma-separated list>`, then rebuild (`docker compose ... up -d --build`). Case-insensitive, whitespace around commas tolerated.
- Keep it in lockstep with the Access policy — same emails in both places. Access rejects strangers at Cloudflare's edge; `ALLOWED_EMAILS` rejects them at session creation.
- A rejected sign-in surfaces as `?error=failed_to_create_session` on the sign-in page (Better Auth's generic failure), not a bespoke "not invited" message — acceptable for a vetted-invitees app.
- Unlike the Access policy, changing this list means an env edit + container restart on the VM, not a dashboard edit. Access remains the quick lever; this is the backstop.

### As applied (2026-08-25)

What actually happened when this ran, where it differed from the plan above:

- **Tunnel**: `home-edge`, created via Zero Trust → Networks → Tunnels & Mesh. Public hostnames now live on the tunnel's **"Published application routes"** tab (the dashboard renamed them); the route is `refresh.example.com` → `http://refresh:3000`, and the tunnel's catch-all rule (any other hostname pointed at it) returns `http_status:404`.
- **Token handling**: the connector token never passed through the assistant/chat — Mark copied it from the dashboard and piped it from the clipboard straight into `~/edge/.env` over SSH (`pbpaste | grep -oE 'eyJ...' | ssh ... 'cat >> ~/edge/.env'`).
- **Access app**: application `refresh` (domain `refresh.example.com`), policy named `refresh.example.com` allowing the invited emails (see Confluence for the live list), session duration 1 month. "Accept all available identity providers" is on, which on this account resolves to **one-time PIN only** — no other IdP is configured.
- **DNS**: the old grey-cloud A record had a **1-day TTL**, so LAN clients kept resolving to the VM (straight to Caddy) until their caches expired — an accidental grace period, no outage during the flip. Once caches expire, everything hairpins through Cloudflare, Access included.
- **`ALLOWED_EMAILS` needed a compose fix**: the base `docker-compose.yml` didn't forward the var into the `app` container (`--env-file` only does compose-file substitution). Fixed by adding it to the `environment:` map.
- **Pi-hole split DNS applied later the same day** (section 4 below). One gotcha: after adding the Local DNS record, the Pi-hole kept serving its previously-cached Cloudflare edge IPs *alongside* the local record (stale entries, visible as TTL 0) until its DNS cache was flushed (Settings → System → Flush DNS cache, or `pihole restartdns`). Post-flush it answers with only the VM's LAN IP. Also worth knowing: browsers hold their own DNS cache and keep-alive sockets, so a DNS-side change isn't visible in an already-running browser until it's fully restarted.
- **Verified**: `curl --resolve refresh.example.com:443:<cf-edge-ip>` returns the 302 to `<team>.cloudflareaccess.com` — Access intercepts before the origin. App-level gate verified live in the container (correct allowlist entry count loaded).
- **Branded-email assets bypass (added 2026-08-25)**: transactional emails (magic link, and household invites — added the same day via the org plugin's `sendInvitationEmail`) reference `public/brand/email-icon.png` / `email-wordmark.png` in their header (`src/lib/email.ts`). Mail clients and Gmail's image proxy fetch these unauthenticated, so a second Access application (`refresh`, destination `refresh.example.com/brand`) carries a **Bypass**-everyone policy (`brand-assets-public`) — Access evaluates Bypass policies before Allow, so just that path is public while everything else stays gated. Only ever put non-sensitive, world-readable assets under `public/brand/`.

### 4. Pi-hole split DNS (LAN path)

Pi-hole admin → Local DNS → DNS Records: `refresh.example.com` → `<VM LAN IP>`.

LAN clients then resolve straight to the VM and hit Caddy as they always have — no tunnel hairpin, no Access prompt at home, real LE certificate. Verify with `dig refresh.example.com @<pihole-ip>` (expect the LAN IP) vs `dig refresh.example.com @1.1.1.1` (expect Cloudflare edge IPs).

Known behaviours, both fine:

- Devices with hardcoded DoH (Android/Chrome "Private DNS", iCloud Private Relay) ignore the Pi-hole and take the Cloudflare path even at home — just a hairpin, everything still works.
- **Chrome vs split DNS (cost real debugging time, 2026-08-25)**: Chrome caches per-hostname transport state learned via the Cloudflare path — alt-svc "this host speaks HTTP/3", TLS session state, and extra DNS lookups (HTTPS/type-65 records carrying Cloudflare's ECH keys). Back on the LAN path this produced `ERR_QUIC_PROTOCOL_ERROR` (Chrome tried QUIC at Caddy, but `~/edge` only published TCP 443 — **fixed**: `443:443/udp` is now published and Caddy's HTTP/3 listener serves it; no ufw change needed since Docker's port publishing bypasses ufw) and then `ERR_SSL_PROTOCOL_ERROR` (stale CF-era TLS/ECH state against Caddy). Two-part cure: give the Pi-hole full authority over the name — `misc.dnsmasq_lines` → `local=/refresh.example.com/` — so non-A query types get a clean NODATA instead of inconsistent/forwarded answers, and clear Chrome's cached data once (its poisoned caches also age out on their own). Safari/curl are unaffected throughout.
- Guests on the home Wi-Fi bypass Access entirely (they resolve via Pi-hole). They still face the app's own sign-in, so nothing is open — but the email allowlist only guards the *external* path.

### 5. Firewall / router

Nothing changes. The tunnel is outbound-only from `cloudflared`; no ports are forwarded on the router, and ufw's LAN-only 443/80 rules stay exactly as they are.

### 6. Verify

- From mobile data (off Wi-Fi): `https://refresh.example.com` → Access prompt → OTP/Google → app sign-in works end-to-end (Google and magic link both).
- An email *not* on the Access policy is refused before reaching the app.
- From the LAN (which bypasses Access): a sign-in attempt with an email not in `ALLOWED_EMAILS` fails with `?error=failed_to_create_session`, and a magic-link request for it sends no email (check Resend's log shows nothing).
- On the LAN: cert is the Let's Encrypt one (not Cloudflare's), no Access prompt, app works as before.
- `docker compose logs cloudflared` in `~/edge` shows established connections, no reconnect loops.

### Caveats

- Cloudflare's proxy caps request bodies at **100 MB** (free plan) — relevant to PDF imports on the external path only; the LAN path is uncapped.
- Removing someone later is a three-place job: the Access policy **plus** revoking their active Access session (Zero Trust → My Team → Users — the policy edit alone doesn't kill an existing session cookie), **plus** `ALLOWED_EMAILS` in `.env.docker` (+ restart). The app-level gate fires on session *creation*, so their existing 30-day Better Auth session also outlives the edit — delete their `Session` rows via `psql` if removal needs to be immediate.
- `AUTH_URL` / `AUTH_TRUSTED_ORIGINS` already point at `https://refresh.example.com` — no app env changes needed for any of this.
