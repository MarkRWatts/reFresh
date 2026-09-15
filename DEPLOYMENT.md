# Deployment (Proxmox VM, via Ansible)

> **Placeholders, deliberately.** Hostnames, IPs, account/team names, and guest emails in this doc are genericized (`refresh.example.com`, `<vm-ip>` for the app's VM, `<tunnel-vm-ip>`, …). The real values live in the private Confluence space **reFresh** → "Deployment — concrete values & sensitive notes".

Production runs on its own Ubuntu VM on Proxmox, deployed entirely by the Ansible project in [`../ansible-homelab`](../ansible-homelab) (a sibling folder, not a git repo) — the house guide for this pattern is [`../DOCKER-DEPLOY-PLAYBOOK.md`](../DOCKER-DEPLOY-PLAYBOOK.md). Nothing about the deployment is done by hand on the VM. It moved there on 2026-09-15 from the shared TrueNAS VM it had lived on since leaving the Mac — see [History](#history-the-shared-truenas-vm) for that setup, kept as a record.

**Live at**: `https://refresh.example.com` — open to invited households on the internet through a Cloudflare Tunnel with Cloudflare Access in front (no port-forwarding), and reached directly on the LAN via Pi-hole split DNS, with a real Let's Encrypt certificate. Multi-household auth (Google + magic-link, via Better Auth) as of Phase 16 — see [Multi-household auth](#multi-household-auth-phase-16) for the Google/Resend setup and the one-time schema migration + backfill it needed, and [Going public](#going-public-cloudflare-tunnel--access--pi-hole-split-dns) for how the tunnel, Access, split DNS, and the `ALLOWED_EMAILS` gate were set up.

## 1. Where it runs

- **VM**: `refresh-vm` (VMID 652, `<vm-ip>`) on the Proxmox host `proxmox01` — 4 GB RAM, CPU type `host`. It sits on VLAN 6, the internet-facing-apps VLAN, isolated from the main LAN and from VLAN 5.
- **Checkout**: `~/reFresh` on the VM, compose project `refresh`, run with `docker-compose.yml` + [`docker-compose.prod.yml`](docker-compose.prod.yml). The prod overlay joins `app` to the VM-local external `edge` Docker network under the alias `refresh`, so the VM's Caddy reaches it as `refresh:3000`. [`docker-compose.override.yml`](docker-compose.override.yml) (which publishes port 3000 on the host) is only auto-loaded by the Mac's local/dev workflow, never here.
- **Reverse proxy**: the VM's own Caddy (Ansible role `edge`), serving just `refresh.example.com`.
- **Data**: Docker volumes `refresh_pgdata` (Postgres 16), `refresh_recipe-images` (cover/step photos for custom/imported recipes), and `refresh_db-backups` (`npm run db:snapshot` output), all carried over from the old server — see [Move to Proxmox](#move-to-proxmox-2026-09-15). The scraper's HTML cache (`refresh_scraper-cache`) wasn't; it's disposable and refills on the next scrape.

## 2. How requests reach it

Two paths, same URL, same certificate:

- **LAN**: Pi-hole local DNS record `refresh.example.com` → `<vm-ip>` → the VM's Caddy on 443 → `refresh:3000`. The main network is allowed into VLAN 6 on 443, which is all this path needs. No Access prompt at home.
- **Public**: Cloudflare's edge → **Cloudflare Access** (email allowlist) → Cloudflare Tunnel `home-edge` → its connector on `tunnel-vm` (VMID 651, `<tunnel-vm-ip>`, Ansible role `tunnel`), which serves every public app → `https://<vm-ip>` → the VM's Caddy → `refresh:3000`.

The tunnel's route lives in the Zero Trust dashboard (tunnel `home-edge` → **Published application routes**): `refresh.example.com` → service `https://<vm-ip>`, with **TLS → Origin Server Name** set to `refresh.example.com`. Don't drop the Origin Server Name: without it the connector sends the IP as the SNI and the TLS handshake with Caddy fails.

App-level auth (Better Auth) and the `ALLOWED_EMAILS` gate apply on both paths; Access is an extra outer gate on the public path only — see [Going public](#going-public-cloudflare-tunnel--access--pi-hole-split-dns) for the Access policy and why both layers exist.

## 3. HTTPS certificate

The VM's Caddy gets a real Let's Encrypt certificate via DNS-01 through its **own acme-dns account**, registered on 2026-09-15 just for reFresh. The DNS side of that is one record (apex zone, Cloudflare):

| Type | Host | Value |
| --- | --- | --- |
| CNAME | `_acme-challenge.refresh` | `<fulldomain from the 2026-09-15 acme-dns registration>` |

Because the challenge is DNS-based, it doesn't care that the public `refresh` record points at the tunnel — which is what keeps the LAN path warning-free. The acme-dns account reFresh used on the old shared server isn't reFresh's any more (it now belongs only to another app's staging site), so don't reuse its credentials here.

## Updating the deployment

Push to `main`, then run the playbook from the Ansible project:

```bash
git push origin main
cd ../ansible-homelab
ansible-playbook playbook.yml --limit refresh-vm
```

The playbook pulls `main` onto the VM with the VM's read-only GitHub deploy key, rebuilds and restarts the stack only when the commit changed, and finishes by checking the site answers over HTTPS through the VM's Caddy. Prisma migrations still run on boot (the `app` container runs `prisma migrate deploy` before `next start`), so a pushed migration is applied by the same run. There's no `ssh` + `git pull` + `docker compose up` step any more — the playbook is the deploy.

## Secrets (`.env.docker`)

The VM's `.env.docker` (`POSTGRES_*`, `AUTH_*`, `RESEND_API_KEY`, `ALLOWED_EMAILS` — see `.env.docker.example` for the full set) is never edited on the VM. Its contents live in the Ansible vault, as `vault_app_env_file` in the Ansible project's `host_vars/refresh-vm/vault.yml`, and the playbook writes it out. To change any of it:

```bash
cd ../ansible-homelab
ansible-vault edit host_vars/refresh-vm/vault.yml
ansible-playbook playbook.yml --limit refresh-vm
```

A changed env file makes the playbook recreate the containers even when the commit hasn't changed. HTTPS has nothing to add here — that's the Caddy side (Ansible role `edge`).

## Backups

- **Twice daily, Proxmox**: the whole VM is backed up to the host's `backup-hdd` storage by the scheduled job that covers every VM. With one app per VM, that covers `refresh_pgdata` and `refresh_recipe-images`. The VM runs the QEMU guest agent, so Proxmox freezes its filesystems during each snapshot, which gives a consistent copy of the Postgres files.
- **Nothing inside the VM**: no backup cron or script runs there. In-VM backups are controlled by `app_backup_enabled` in the Ansible project's `roles/app`, which defaults to `false`.

To restore, restore the VM from a Proxmox backup (`proxmox01` → `backup-hdd` → Backups → Restore), or restore it to a new VMID and copy the data out. A one-off dump can still be taken by hand when wanted — `docker exec refresh-db-1 pg_dump -U refresh -Fc refresh > refresh.dump` on the VM, restored with `pg_restore` (same shape as the [original Mac → VM restore](#6-data-migration-mac--vm)) — but nothing does this automatically. `refresh_db-backups` is something else: it's where `npm run db:snapshot` writes, not a VM backup. The old shared server's `~/backups/backup-databases.sh` cron no longer covers reFresh.

## Break-glass access

For looking, not deploying:

```bash
ssh -i ~/.ssh/dockerapps_deploy_ed25519 deploy@<vm-ip>
docker exec -it refresh-db-1 psql -U refresh refresh
cd ~/reFresh && docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml logs app
```

`deploy` is in the `docker` group but has no sudo. Make real changes in the Ansible project and rerun the playbook, so the VM never drifts from it.

## Multi-household auth (Phase 16)

Adds Google + magic-link sign-in (Better Auth) and per-household favourites/hidden/this-week state, replacing the original single-user/no-auth design — see `prisma/schema.prisma` and `project-plan.md`'s Phase 16 entry for the data model. This section covers what was specific to standing that up in production. It was done in Phase 16 on the old shared TrueNAS VM (see [History](#history-the-shared-truenas-vm)), by hand over SSH, and is kept as a record of what was done: on the current setup, the `ssh` / `git pull` / `docker compose up` steps below are the playbook run in [Updating the deployment](#updating-the-deployment), and env vars go in the vault (see [Secrets](#secrets-envdocker)).

### 1. Google OAuth client

Google Cloud Console → APIs & Services → Credentials → create an OAuth client (type: Web application), separate from any other app's client (jobAppTracker, jinglejotter.com) so the credentials stay independent. Authorized redirect URI: `https://refresh.example.com/api/auth/callback/google`. Note the client ID/secret for `.env.docker` below.

### 2. Resend domain verification

`refresh.example.com` verified in Resend for the `noreply@refresh.example.com` sending address (see `src/lib/email.ts`) — SPF/DKIM records added via Cloudflare, plus a DMARC record (`_dmarc.refresh` TXT `v=DMARC1; p=none;`, TTL Auto) on the apex zone. Note the Resend API key for `.env.docker` below.

### 3. `.env.docker` additions

Add to `.env.docker` (today that means the vault's `vault_app_env_file` — see [Secrets](#secrets-envdocker); see `.env.docker.example` for the full set): `AUTH_SECRET` (generate with `openssl rand -base64 32`), `AUTH_URL=https://refresh.example.com`, `AUTH_TRUSTED_ORIGINS=https://refresh.example.com`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (from step 1), `RESEND_API_KEY` (from step 2).

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

Runbook for opening `https://refresh.example.com` to invited friends/family on the internet. No port-forwarding, and the home IP never appears in DNS. **Applied 2026-08-25** on the old shared VM — see [As applied](#as-applied-2026-08-25) below for the deltas between this plan and what the dashboard looked like afterwards. **Re-homed 2026-09-15**: same tunnel, same Access setup, but the connector now runs on `tunnel-vm` and the route points at the app VM's Caddy over HTTPS — see [How requests reach it](#2-how-requests-reach-it). Where a step below describes the old shared VM, it says so.

The shape: externally, a **Cloudflare Tunnel** carries traffic from Cloudflare's edge into the home network over an outbound-only connection, with **Cloudflare Access** (an email allowlist, free tier covers 50 users) gating it before a request ever reaches the VM. Internally, the **Pi-hole** answers `refresh.example.com` with the VM's LAN IP, so LAN clients hit the VM's Caddy directly — same URL, same real Let's Encrypt certificate on both paths (Caddy's cert comes via DNS-01/acme-dns, which doesn't care where the public record points, so the LAN path stays warning-free). App-level auth (Better Auth) is unchanged and applies on both paths; Access is an extra outer gate on the external path only.

### Why a separate tunnel (not another app's)

One cloudflared tunnel *can* route any number of hostnames across every zone in the same Cloudflare account, so sharing an existing tunnel is technically possible. It's still the wrong move when that tunnel belongs to another app's own compose stack: it sits on that stack's network, shares that stack's lifecycle (teardowns, rebuilds, possible re-homing to other hardware), and anything piggybacking on it loses its ingress the day that stack moves. Tunnels are free and unlimited, so separation costs nothing.

Instead, follow the house pattern: a tunnel that fronts apps is shared infrastructure, owned by no single app's repo. On the old shared VM that meant **it lived in `~/edge`** alongside Caddy; since 2026-09-15 the same `home-edge` tunnel's connector runs on its own VM, `tunnel-vm` (Ansible role `tunnel`), and serves every public app. A future app going public just adds a published application route to *this* tunnel.

### 1. Create the tunnel

*As originally done on the old shared VM — superseded: the connector now runs on `tunnel-vm`, deployed by the Ansible `tunnel` role.*

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

In the tunnel's **Published application routes** tab (originally called "Public hostnames"): `refresh.example.com` → service `https://<vm-ip>`, with **TLS → Origin Server Name** `refresh.example.com` — see [How requests reach it](#2-how-requests-reach-it) for why the Origin Server Name is required.

Two DNS notes (apex zone, Cloudflare):

- The dashboard creates a **proxied CNAME** for `refresh` pointing at the tunnel — the existing grey-cloud `A refresh → <VM LAN IP>` record had to be deleted first (the dashboard will refuse or prompt otherwise).
- **Keep `CNAME _acme-challenge.refresh`** (the acme-dns delegation). Caddy's LAN-path certificate renewal depends on it.

Originally (2026-08-25 to 2026-09-15) the route was `http://refresh:3000`: the connector sat on the shared VM's `edge` network, so it reached the app by the same alias Caddy did, and skipping Caddy avoided per-hostname origin-TLS/SNI config, since the tunnel provides its own TLS on the external leg. That relied on the connector sharing a Docker network with the app, which stopped being true when it moved to `tunnel-vm` — so the route now goes through the app VM's Caddy over HTTPS, which is where the Origin Server Name comes in.

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

- Set `ALLOWED_EMAILS=<comma-separated list>` in `.env.docker` — i.e. in the vault, then run the playbook (see [Secrets](#secrets-envdocker)); the changed env file recreates the containers. Case-insensitive, whitespace around commas tolerated.
- Keep it in lockstep with the Access policy — same emails in both places. Access rejects strangers at Cloudflare's edge; `ALLOWED_EMAILS` rejects them at session creation.
- A rejected sign-in surfaces as `?error=failed_to_create_session` on the sign-in page (Better Auth's generic failure), not a bespoke "not invited" message — acceptable for a vetted-invitees app.
- Unlike the Access policy, changing this list means a vault edit + playbook run, not a dashboard edit. Access remains the quick lever; this is the backstop.

### As applied (2026-08-25)

What actually happened when this ran on the old shared VM, where it differed from the plan above (later changes noted inline):

- **Tunnel**: `home-edge`, created via Zero Trust → Networks → Tunnels & Mesh. Public hostnames now live on the tunnel's **"Published application routes"** tab (the dashboard renamed them); the route was `refresh.example.com` → `http://refresh:3000` (since 2026-09-15: `https://<vm-ip>` with an Origin Server Name — see section 2), and the tunnel's catch-all rule (any other hostname pointed at it) returns `http_status:404`.
- **Token handling**: the connector token never passed through the assistant/chat — Mark copied it from the dashboard and piped it from the clipboard straight into `~/edge/.env` over SSH (`pbpaste | grep -oE 'eyJ...' | ssh ... 'cat >> ~/edge/.env'`). The connector has since moved to `tunnel-vm`, deployed by the Ansible `tunnel` role.
- **Access app**: application `refresh` (domain `refresh.example.com`), policy named `refresh.example.com` allowing the invited emails (see Confluence for the live list), session duration 1 month. "Accept all available identity providers" is on, which on this account resolves to **one-time PIN only** — no other IdP is configured.
- **DNS**: the old grey-cloud A record had a **1-day TTL**, so LAN clients kept resolving to the VM (straight to Caddy) until their caches expired — an accidental grace period, no outage during the flip. Once caches expire, everything hairpins through Cloudflare, Access included.
- **`ALLOWED_EMAILS` needed a compose fix**: the base `docker-compose.yml` didn't forward the var into the `app` container (`--env-file` only does compose-file substitution). Fixed by adding it to the `environment:` map.
- **Pi-hole split DNS applied later the same day** (section 4 below). One gotcha: after adding the Local DNS record, the Pi-hole kept serving its previously-cached Cloudflare edge IPs *alongside* the local record (stale entries, visible as TTL 0) until its DNS cache was flushed (Settings → System → Flush DNS cache, or `pihole restartdns`). Post-flush it answers with only the VM's LAN IP. Also worth knowing: browsers hold their own DNS cache and keep-alive sockets, so a DNS-side change isn't visible in an already-running browser until it's fully restarted.
- **Verified**: `curl --resolve refresh.example.com:443:<cf-edge-ip>` returns the 302 to `<team>.cloudflareaccess.com` — Access intercepts before the origin. App-level gate verified live in the container (correct allowlist entry count loaded).
- **Branded-email assets bypass (added 2026-08-25)**: transactional emails (magic link, and household invites — added the same day via the org plugin's `sendInvitationEmail`) reference `public/brand/email-icon.png` / `email-wordmark.png` in their header (`src/lib/email.ts`). Mail clients and Gmail's image proxy fetch these unauthenticated, so a second Access application (`refresh`, destination `refresh.example.com/brand`) carries a **Bypass**-everyone policy (`brand-assets-public`) — Access evaluates Bypass policies before Allow, so just that path is public while everything else stays gated. Only ever put non-sensitive, world-readable assets under `public/brand/`.

### 4. Pi-hole split DNS (LAN path)

Pi-hole admin → Local DNS → DNS Records: `refresh.example.com` → `<vm-ip>` (the Proxmox VM since 2026-09-15; before that, the shared VM's LAN IP).

LAN clients then resolve straight to the VM and hit its Caddy directly — no tunnel hairpin, no Access prompt at home, real LE certificate. The main network is allowed into VLAN 6 on 443, which is what lets them reach it. Verify with `dig refresh.example.com @<pihole-ip>` (expect `<vm-ip>`) vs `dig refresh.example.com @1.1.1.1` (expect Cloudflare edge IPs).

Known behaviours, both fine:

- Devices with hardcoded DoH (Android/Chrome "Private DNS", iCloud Private Relay) ignore the Pi-hole and take the Cloudflare path even at home — just a hairpin, everything still works.
- **Chrome vs split DNS (cost real debugging time, 2026-08-25)**: Chrome caches per-hostname transport state learned via the Cloudflare path — alt-svc "this host speaks HTTP/3", TLS session state, and extra DNS lookups (HTTPS/type-65 records carrying Cloudflare's ECH keys). Back on the LAN path this produced `ERR_QUIC_PROTOCOL_ERROR` (Chrome tried QUIC at Caddy, but the old shared `~/edge` only published TCP 443 — **fixed** there by publishing `443:443/udp` so Caddy's HTTP/3 listener serves it; the current VM's Caddy, Ansible role `edge`, publishes `443/udp` too) and then `ERR_SSL_PROTOCOL_ERROR` (stale CF-era TLS/ECH state against Caddy). Two-part cure: give the Pi-hole full authority over the name — `misc.dnsmasq_lines` → `local=/refresh.example.com/` — so non-A query types get a clean NODATA instead of inconsistent/forwarded answers, and clear Chrome's cached data once (its poisoned caches also age out on their own). Safari/curl are unaffected throughout.
- Guests on the home Wi-Fi bypass Access entirely (they resolve via Pi-hole). They still face the app's own sign-in, so nothing is open — but the email allowlist only guards the *external* path.

### 5. Firewall / router

No ports are forwarded on the router — the tunnel is outbound-only from `cloudflared` on `tunnel-vm`. The app's VM sits on VLAN 6, isolated from the main LAN and from VLAN 5; the main network is allowed into VLAN 6 on 443 for the LAN path.

### 6. Verify

- From mobile data (off Wi-Fi): `https://refresh.example.com` → Access prompt → OTP/Google → app sign-in works end-to-end (Google and magic link both).
- An email *not* on the Access policy is refused before reaching the app.
- From the LAN (which bypasses Access): a sign-in attempt with an email not in `ALLOWED_EMAILS` fails with `?error=failed_to_create_session`, and a magic-link request for it sends no email (check Resend's log shows nothing).
- On the LAN: cert is the Let's Encrypt one (not Cloudflare's), no Access prompt, app works as before.
- The tunnel shows **Healthy** in the dashboard, and the `cloudflared` connector's logs on `tunnel-vm` show established connections, no reconnect loops.

### Caveats

- Cloudflare's proxy caps request bodies at **100 MB** (free plan) — relevant to PDF imports on the external path only; the LAN path is uncapped.
- Removing someone later is a three-place job: the Access policy **plus** revoking their active Access session (Zero Trust → My Team → Users — the policy edit alone doesn't kill an existing session cookie), **plus** `ALLOWED_EMAILS` in the vault's `.env.docker` contents (+ playbook run, see [Secrets](#secrets-envdocker)). The app-level gate fires on session *creation*, so their existing 30-day Better Auth session also outlives the edit — delete their `Session` rows via `psql` (see [Break-glass access](#break-glass-access)) if removal needs to be immediate.
- `AUTH_URL` / `AUTH_TRUSTED_ORIGINS` already point at `https://refresh.example.com` — no app env changes needed for any of this.

## History: the shared TrueNAS VM

From leaving the Mac until 2026-09-15, reFresh ran on a shared Ubuntu Server VM on TrueNAS — the same VM [jobAppTracker](https://github.com/MarkRWatts/jobAppTracker) ran on — behind a **shared** Caddy reverse proxy (`~/edge`, see [jobAppTracker's `DEPLOYMENT.md`](https://github.com/MarkRWatts/jobAppTracker/blob/main/DEPLOYMENT.md)), which later also held the `home-edge` tunnel connector. Updates there were `ssh` + `git pull` + `docker compose ... up -d --build` by hand, and backups came from a shared `~/backups/backup-databases.sh` cron. **None of that applies any more** — don't ssh to that server, `git pull` there, edit `~/edge`, or run compose there for reFresh. Sections 1–9 are how the app first got there, kept as a record; [Move to Proxmox](#move-to-proxmox-2026-09-15) is how it left.

### 1. Prerequisites already in place

The VM already had Docker, ufw, and `dnsutils` installed (from setting up jobAppTracker first), and the shared `~/edge` Caddy stack already existed — adding this app meant adding a site block there, not standing up a new proxy.

### 2. Get the code

```bash
git clone https://github.com/MarkRWatts/reFresh.git ~/reFresh
```
(HTTPS, not this repo's configured SSH remote — no need to put a real SSH key on the VM for a public repo.)

### 3. `docker-compose.override.yml` / `docker-compose.prod.yml`

Mirrors the split jobAppTracker uses. The base `docker-compose.yml`'s `app` service no longer publishes port 3000 directly:
- [`docker-compose.override.yml`](docker-compose.override.yml) — moves that `ports: ["3000:3000"]` back, auto-loaded only when no `-f` flags are given (i.e. the Mac's local/dev workflow), so nothing changes there.
- [`docker-compose.prod.yml`](docker-compose.prod.yml) — the VM-only overlay. Joins `app` to the external `edge` network under the alias `refresh`, so the shared Caddy could reach it as `refresh:3000`. No auth vars to add here (unlike jobAppTracker) — this file is deliberately small.

### 4. DNS + acme-dns

Own acme-dns registration (kept separate from jobAppTracker's, to avoid a renewal race between apps sharing one account):

```bash
curl -X POST https://auth.acme-dns.io/register
```

Two DNS records added at Easyspace:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | `_acme-challenge.refresh` | `<fulldomain from registration>` |
| A | `refresh` | `<VM's LAN IP>` |

Then a site block for `refresh.example.com` was added to `~/edge/Caddyfile` and its acme-dns credentials to `~/edge/.env` — see jobAppTracker's `DEPLOYMENT.md` for the shared Caddyfile's exact shape. (Both records have since changed: the A record gave way to the tunnel's proxied CNAME when going public, and the `_acme-challenge` CNAME now points at reFresh's 2026-09-15 acme-dns account — see [HTTPS certificate](#3-https-certificate).)

### 5. `.env.docker`

Created directly on the server (never committed — see `.env.docker.example`). `POSTGRES_USER` / `POSTGRES_PASSWORD` (rotated fresh) / `POSTGRES_DB`, plus (as of Phase 16) the `AUTH_*`/`RESEND_API_KEY` vars for multi-household sign-in — see [Multi-household auth](#multi-household-auth-phase-16). HTTPS itself had nothing to add here — that lived in `~/edge`. (Now: the Ansible vault — see [Secrets](#secrets-envdocker).)

### 6. Data migration (Mac → VM)

Three named volumes existed (`pgdata`, `scraper-cache`, `db-backups`); only `pgdata` (the live database) and `db-backups` (historical `npm run db:snapshot` output) were carried over. `scraper-cache` is pure HTML cache and was skipped — it regenerates on the next scrape.

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

### 7. Bring up

```bash
cd ~/reFresh
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml up -d --build
cd ~/edge && docker compose up -d --build   # picks up the new site block + issues its cert
```

### 8. Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://refresh.example.com/   # 200, valid cert
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.prod.yml logs app   # "No pending migrations to apply"
```
Then open it in a browser and confirm the recipe count and meal plan match what was on the Mac (compare `SELECT COUNT(*) FROM "Recipe";` via `docker exec ... psql` on both if in doubt — the homepage's displayed count is a filtered view, not the raw table total).

### 9. Cutover

Once verified, the Mac's containers were stopped (not removed, for an easy rollback):
```bash
docker stop refresh-app-1 refresh-db-1
```
`docker start refresh-app-1 refresh-db-1` brings the old Mac instance straight back if ever needed.

### Move to Proxmox (2026-09-15)

The app moved off the shared VM onto its own Proxmox VM, `refresh-vm`, deployed by the Ansible project (see [Where it runs](#1-where-it-runs)):

- **Data**: volumes `refresh_pgdata`, `refresh_recipe-images`, and `refresh_db-backups` were carried over; row counts were verified afterwards — 16 tables, 189,130 rows, identical on both sides. `refresh_scraper-cache` wasn't (disposable cache).
- **HTTPS**: a new acme-dns account was registered just for reFresh and `_acme-challenge.refresh` repointed at it; the VM's own Caddy (Ansible role `edge`) replaced the shared one.
- **LAN path**: the Pi-hole record `refresh.example.com` now points at the new VM (`<vm-ip>`).
- **Public path**: same `home-edge` tunnel, but its connector moved to `tunnel-vm`, and the route changed from `http://refresh:3000` to `https://<vm-ip>` with an Origin Server Name. Access and `ALLOWED_EMAILS` unchanged.
- **Backups**: the shared server's cron gave way to Proxmox's whole-VM backups (see [Backups](#backups)).
