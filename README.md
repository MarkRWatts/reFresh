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

## Near-duplicate detection

HelloFresh frequently remixes the same "hero" dish (e.g. a fried chicken burger) with
a different side across separate weekly menus. After (re-)scraping, run:

```bash
npm run detect-variants
```

This re-analyzes the whole catalog and marks near-duplicates via `Recipe.variantOfId`,
so only one representative per cluster shows in the default browse view (the others
stay reachable by URL and are linked from the chosen one's detail page).
