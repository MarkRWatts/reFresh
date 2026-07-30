# re:Fresh

A personal web app for browsing HelloFresh (UK) recipes as cards and planning a week's meals around **shared ingredients**, to cut food waste and duplicate shopping. Single-user, no auth, local-first.

Full phase-by-phase history, design rationale, and bugs found along the way: [`../reFresh-docs/project-plan.md`](../reFresh-docs/project-plan.md). This README is the practical "how to run and work on this project" reference.

## Contents

- [Features](#features)
- [Stack](#stack)
- [Getting started](#getting-started)
- [Populating the database](#populating-the-database)
- [npm scripts](#npm-scripts)
- [Project structure](#project-structure)
- [Data model](#data-model)
- [How it works](#how-it-works)
- [Known limitations](#known-limitations)

## Features

- **Card browser** (hiringcafe-inspired): filter bar with protein type (Chicken/Turkey/Beef/Lamb/Pork/Duck/Venison/Other Meat/Fish/Vegetarian/Vegan, each colour-coded consistently everywhere), cuisine, calories, cook time, free-text search, a Favourites toggle, and a "show all" toggle that reveals near-duplicate recipes normally hidden behind their primary.
- **Recipe detail pages**: full ingredients list with a 2/3/4-person serving-size picker that scales quantities live, full nutrition breakdown, step-by-step instructions with photos where HelloFresh provides them, a link to similar variants, a print button, and a "Clone & customize" action.
- **Weekly planner** (persistent drawer): add/remove recipes, adjust each recipe's serving count independently, see which canonical ingredients are shared across 2+ recipes, and a consolidated shopping list with quantities summed per matching unit — plus a printable, checklist-style version of the shopping list.
- **Auto-suggest**: given the currently active browse filters, greedily picks combinations of recipes that maximize shared ingredients (a real optimization, not just "recipes with similar names") — never repeats a recipe across the returned options.
- **Favourites**: heart-toggle on cards and the detail page, plus a filter.
- **Custom recipes**: clone any recipe and edit its ingredient list (add/remove) — a "My recipe" badge distinguishes these from the scraped catalog, and its protein-type classification is re-derived automatically as you edit.

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind v4** — almost entirely Server Components and Server Actions; the few client islands (toggle buttons, the plan drawer, filter bar, print button, servings pickers) are called out explicitly in the code.
- **Prisma 7** + **PostgreSQL**, via `@prisma/adapter-pg` (Prisma 7 requires an explicit driver adapter).
- **A standalone scraper** (`scripts/scrape.ts`), decoupled from the request path: it populates Postgres from HelloFresh's public sitemap + per-page `schema.org/Recipe` JSON-LD (plus an internal app-data blob for richer per-step photos). The app itself never talks to HelloFresh live.
- No hosting/deployment set up yet — this has only run locally so far.

## Getting started

Prerequisites: Node.js, a local PostgreSQL server.

```bash
brew services start postgresql@16   # this machine has no Docker
createdb refresh_dev
npm install
cp .env.example .env                # adjust DATABASE_URL if your setup differs
npx prisma migrate deploy           # applies every migration in prisma/migrations, in order
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). At this point the database schema exists but is empty — see [Populating the database](#populating-the-database) below.

`prisma migrate deploy` (not `migrate dev`) is what you want for a fresh database: it just replays the existing migration files non-interactively. `migrate dev` is for *generating new* migrations against a live dev database, and this project doesn't actually use it for that — see [How it works § schema migrations](#schema-migrations) for why.

## Populating the database

Two ways to get real data, in order of preference:

1. **Restore a snapshot**, if you have one (`db-backups/refresh.dump` — gitignored, since it's tens of MB, so it won't exist on a fresh clone unless you copy it over from another machine):
   ```bash
   npm run db:restore
   ```
   This is seconds instead of the ~40-minute full crawl below.

2. **Run the scraper** against HelloFresh's public sitemap:
   ```bash
   npm run scrape -- --sample=50      # small sample first, sanity-check the output
   npm run scrape                      # full crawl (~16.5k recipe pages)
   npm run detect-variants             # cluster near-duplicate recipes (run after any (re-)scrape)
   ```
   Every fetched page is cached to disk (`.cache/hellofresh/html/`, gitignored), so re-running the scraper — or changing parsing/classification logic and running `npm run reprocess` — never re-hits the network for a page it's already seen. `npm run detect-variants` should be re-run any time the *browsable* recipe set changes (a fresh crawl, or a `computeIsBrowsable`/classification change), since it resets and recomputes `Recipe.variantOfId` for the whole catalog each time.

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run scrape -- [flags]` | Crawl the HelloFresh sitemap into Postgres. Flags: `--sample=N` (stratified sample across the whole sitemap), `--limit=N` (stop after N *new* pages), `--concurrency=N` (default 5), `--delay-ms=N` (default 200, politeness delay between live fetches), `--force` (re-process every sitemap URL even if already up to date) |
| `npm run reprocess` | `scrape --force`, but every page is already cached — reapplies current parsing/classification logic to the whole catalog with **zero network requests**. This is the standard way to backfill a code change (see [How it works](#how-it-works)) |
| `npm run detect-variants` | Re-cluster near-duplicate recipes across the whole browsable catalog |
| `npm run db:snapshot` | `pg_dump` the database to `db-backups/refresh.dump` |
| `npm run db:restore` | Restore `db-backups/refresh.dump` into the configured database (must already exist, e.g. via `createdb`) |
| `npm run generate-favicon` | Regenerate `src/app/icon.svg` + `src/app/favicon.ico` from the single source SVG in `src/lib/brand/logo.ts` |

## Project structure

```
prisma/
  schema.prisma            # data model (see below)
  migrations/               # see "schema migrations" — mostly hand-applied, not `migrate dev`-generated
scripts/
  scrape.ts                 # sitemap crawl + per-page parse + upsert
  detect-variants.ts        # near-duplicate clustering job
  db-snapshot.ts / db-restore.ts
  generate-favicon.ts
src/
  app/                      # Next.js App Router routes
    page.tsx                 # card browser ("/")
    recipes/[slug]/           # detail page, + edit/ for custom-recipe ingredient editing
    suggest/                  # auto-suggest page
    plan/print/                # printable shopping list
  components/                # mostly small client islands next to Server Component pages
  lib/
    scraper/                 # sitemap fetch, JSON-LD/app-data parsing, ingredient-line parsing,
                              #   canonicalization, protein-type classification, DB upsert
    recipes/                 # query layer, filters, shared-ingredients/shopping-list math,
                              #   variant detection, custom-recipe clone/edit actions
    mealplan/                 # the (single, implicit) weekly plan: queries, actions, auto-suggest
    favourites/                # favourite toggle action
    brand/                     # logo SVG source
  generated/prisma/           # Prisma client output (gitignored, regenerated via `prisma generate`)
```

## Data model

```prisma
Recipe(
  id, hfId, slug, name, subtitle, description, imageUrl, sourceUrl,
  cookMinutes, servings, calories,
  fatGrams, saturatedFatGrams, carbsGrams, sugarGrams, proteinGrams, fiberGrams, saltGrams,
  proteinType, proteinTypeManualOverride, cuisine, category,
  steps (Json),                          // [{text, imageUrl, caption}]
  ratingValue, ratingCount,
  isPublished, isActive,                 // HelloFresh's own metadata, informational only
  isBrowsable,                           // computed at scrape time — see computeIsBrowsable
  variantOfId -> Recipe,                 // near-duplicate clustering, recomputed wholesale by detect-variants
  isFavourite,
  isUserCreated, clonedFromId -> Recipe, // custom recipes (clone & edit)
  lastScrapedAt, createdAt, updatedAt,
)
Ingredient(id, canonicalName, category)
IngredientAlias(id, rawText, ingredientId -> Ingredient)   // raw scraped/typed text -> canonical ingredient
RecipeIngredient(id, recipeId -> Recipe, ingredientId -> Ingredient, quantity, unit, rawText)
MealPlan(id, label, createdAt)                              // single implicit plan, no auth/multi-user
MealPlanRecipe(id, mealPlanId -> MealPlan, recipeId -> Recipe, servings)  // servings: null = use recipe's own base
```

`ProteinType` enum: `CHICKEN | TURKEY | BEEF | LAMB | PORK | DUCK | VENISON | MEAT_OTHER | FISH | VEGETARIAN | VEGAN | UNKNOWN`.

## How it works

A few things that aren't obvious from the schema/routes alone:

**Ingredient canonicalization.** HelloFresh's raw ingredient text varies across recipes and eras ("Garlic Clove" vs "Garlic Cloves" vs "1 unit(s) Garlic Clove"). `src/lib/recipes/ingredientResolution.ts` resolves any raw ingredient string (scraped, or typed into the custom-recipe editor) to a canonical `Ingredient` row, creating an `IngredientAlias` the first time a given raw string is seen. This is what makes "shared ingredients" and shopping-list summing actually work — it's computed on canonical ingredients, never raw text.

**Protein-type classification** (`src/lib/scraper/proteinType.ts`) is a keyword heuristic over ingredient names, since HelloFresh's JSON-LD doesn't carry a dietary-type field. It scores per-species keyword matches per ingredient line and picks the species with the most matches. Two real misclassification bugs were found and fixed by testing against actual scraped data: species words used purely as a seasoning base ("Chicken Stock Pot") were counting as protein signals, and "Burger Bun(s)" was forcing vegetarian recipes to Beef via an ambiguous-cut fallback rule.

**Near-duplicate detection** (`src/lib/recipes/variantDetection.ts`, run via `scripts/detect-variants.ts`) clusters recipes that are the same "hero" dish remixed with a different side across separate weekly menus (confirmed real example: a buffalo chicken burger recipe re-listed under an unrelated name, sharing ~70% of its ingredients). Similarity uses IDF-weighted ingredient overlap so common pantry staples (salt, water, onion) don't create false matches. Clustering is **direct-to-primary** ("star"), not transitive union-find — an earlier transitive version worked fine at a 1,000-recipe tuning sample but collapsed catastrophically at the full ~16k catalog (chain probability grows with catalog size for any fixed threshold), merging unrelated recipes together. Only the cluster's primary shows in the default browse view; the "show all" filter bypasses this.

**Auto-suggest** (`src/lib/mealplan/autoSuggest.ts`) greedily grows a recipe set from a seed, at each step adding whichever candidate shares the most ingredients with the set built so far, repeated from ~40 seeds. This greedy criterion is provably exact (not approximate) for the stated "sum of (recipes sharing this ingredient − 1)" objective. Deliberately does **not** reuse the near-duplicate detector's IDF weighting — there, common ingredients are noise to filter out; here, a shared common ingredient (onion, garlic) is exactly the win the feature exists to surface.

**Missing-image visibility.** hellofresh.co.uk never shows a recipe tile without a photo, so `computeIsBrowsable` (`src/lib/scraper/upsertRecipe.ts`) treats a missing/unusable image as a visibility signal, not just a display fallback — alongside the more obvious "zero ingredients" and "one step" stub-page checks.

<a id="schema-migrations"></a>**Schema migrations are mostly hand-applied, not `prisma migrate dev`-generated.** `migrate dev` requires interactive confirmation for destructive changes and can't auto-diff some changes at all (e.g. splitting the `ProteinType` enum's `MEAT` value into `CHICKEN`/`BEEF`/`PORK`/etc. — Postgres can't just add new enum values when one is also being removed, so the diff needs a data-preserving `CASE` expression Prisma can't generate on its own). The pattern used throughout this project:
```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > migration.sql
# hand-edit migration.sql if needed (e.g. add a USING/CASE clause for a data-preserving type change)
psql -d refresh_dev -f prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate resolve --applied <timestamp>_<name>
```
`migrate resolve --applied` only updates Prisma's own migration-tracking table — it does not run the SQL, so the `psql -f` step has to happen first.

## Known limitations

- Full history and reasoning for all of these: [`project-plan.md § Open items to revisit later`](../reFresh-docs/project-plan.md).
- Hosting is deferred — this has only ever run locally.
- Protein-type classification and the variant-detection similarity threshold are both heuristics, tuned by spot-checking real data rather than exhaustively validated; expect occasional misclassifications.
- No true cross-unit quantity conversion in the shopping list (e.g. tbsp → ml) — an ingredient specified in two different units across recipes shows as two separate totals.
- Custom (cloned) recipes only support editing the ingredient list so far — steps, cook time, servings, etc. still come from the original.
