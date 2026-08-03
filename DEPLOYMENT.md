# VM deployment (TrueNAS)

This documents how the app was moved from the Mac to its production home — the same Ubuntu Server VM on TrueNAS that [jobAppTracker](https://github.com/MarkRWatts/jobAppTracker) runs on, behind a **shared** Caddy reverse proxy. See [jobAppTracker's `DEPLOYMENT.md`](https://github.com/MarkRWatts/jobAppTracker/blob/main/DEPLOYMENT.md) for the base OS setup and the shared Caddy stack itself (`~/edge`) — this doc only covers what's specific to reFresh.

**Live at**: `https://refresh.example.com` — LAN-only (no port-forwarding), real Let's Encrypt certificate, no auth (this app has none — single-user, local-first by design).

Unlike jobAppTracker, this app needs no OAuth setup at all — there's simply nothing to authenticate.

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

Created directly on the server (never committed — see `.env.docker.example`). Just `POSTGRES_USER` / `POSTGRES_PASSWORD` (rotated fresh) / `POSTGRES_DB` — this app has no auth/HTTPS vars of its own, those live in `~/edge`.

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
