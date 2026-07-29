# re:Fresh

A web app for browsing HelloFresh recipes as cards and planning a week's meals around **shared ingredients**, to cut food waste when shopping.

Project plan and background: see `../reFresh-docs/project-plan.md`.

## Stack

- Next.js (App Router, TypeScript) + Tailwind
- Prisma + PostgreSQL
- A standalone scraper script that populates the DB from HelloFresh's public recipe sitemap + per-recipe JSON-LD

## Local development

Prerequisites: Node.js, a running local PostgreSQL (see below).

```bash
npm install
cp .env.example .env   # adjust DATABASE_URL if needed
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local Postgres (Homebrew, no Docker on this machine)

```bash
brew services start postgresql@16
createdb refresh_dev   # already created for local dev
```

## Scraper

```bash
npm run scrape -- --limit 50   # sample run before a full crawl
npm run scrape                 # full crawl of the recipe sitemap
```
