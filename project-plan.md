# HelloFresh Recipe Waste-Minimizer — Project Plan

## Context

Weekly meal planning from HelloFresh recipes currently leads to food waste: picking recipes independently means buying overlapping fresh ingredients (a bag of coriander for one recipe, a single onion for another) and throwing away the unused remainder. The goal is a web app that browses HelloFresh recipes as cards (styled after hiringcafe.com's dense filter bar + compact card grid), and helps pick a week's recipes that deliberately share ingredients, to cut shopping waste.

The open risk going in was whether recipe data could be extracted at all. Investigation resolved this cleanly:
- `robots.txt` explicitly publishes `Sitemap: https://www.hellofresh.co.uk/sitemap_recipe_pages.xml`, and recipe pages are **not** disallowed for crawling (only `/box-week*`, `/my-account`, search-query pages, etc. are blocked).
- That sitemap lists **16,490 recipe URLs** directly — full enumeration, no pagination/infinite-scroll crawling needed.
- Every recipe page embeds a complete `schema.org/Recipe` JSON-LD block (verified on a live page) with: `name`, `image`, `totalTime` (ISO 8601, e.g. `PT35M`), `nutrition` (`calories`, fat, protein, carbs, etc.), `recipeIngredient` (array of strings like `"450 grams Potatoes"`, `"1 unit(s) Garlic Clove"`), `recipeYield`, `recipeCategory`, `recipeCuisine`, and `aggregateRating`.

This means structured extraction via sitemap + JSON-LD is reliable enough that the paper-card OCR fallback isn't needed — dropped from scope per your decision.

Decisions confirmed with you: full JS/TS stack (Next.js + Postgres), design local-first but keep it portable to deploy later, and the planner should support both manual pick-and-see-overlap **and** a later auto-suggest optimizer.

## Architecture

Single Next.js (App Router, TypeScript) project:
- **Frontend**: React + Tailwind, card-grid recipe browser + weekly planner UI.
- **Backend**: Next.js route handlers / server actions, Prisma ORM.
- **Database**: Postgres — this machine had no Docker, so it runs via Homebrew (`brew services start postgresql@16`) instead of docker-compose; still real Postgres, still trivially portable to Neon/Supabase/Fly/a VPS later.
- **Scraper**: a standalone Node/TS script (run manually or via cron later), separate from the request path — it populates Postgres; the app only ever reads from the DB, never hits HelloFresh live.

Data flow: `sitemap_recipe_pages.xml` → per-recipe fetch → parse JSON-LD → normalize ingredients → upsert into Postgres → app queries DB for card grid, filters, and planner.

## Phases

### Phase 0 — Scaffolding
- `create-next-app` (TS, App Router, Tailwind).
- Prisma + Postgres via `docker-compose.yml` for local dev.
- Basic project structure: `/app` (routes/UI), `/lib` (scraper, normalization, DB client), `/prisma/schema.prisma`.

### Phase 1 — Scraper
- Fetch and parse `sitemap_recipe_pages.xml` (XML `<loc>`/`<lastmod>` pairs) to get all recipe URLs + last-modified dates.
- For each URL not yet scraped (or whose `lastmod` changed): fetch HTML, extract the `<script type="application/ld+json">` block whose `@type` is `Recipe`, parse the fields listed above.
- Politeness: bounded concurrency (e.g. 5 in flight), small delay between requests, a real but honest User-Agent, cache fetched HTML to disk keyed by URL so re-parsing during development doesn't re-hit the site. This is read-only access to public pages already permitted by robots.txt, for personal non-redistributed use.
- Parse `recipeIngredient` strings into `{quantity, unit, rawName}` (simple regex: leading number/fraction, optional unit token, remainder is the name).
- Derive `proteinType` (meat / fish / vegetarian / vegan) — not directly in the JSON-LD — via a keyword heuristic over ingredient names and `recipeCategory`/cuisine, cross-checked against the site's own collection pages (`/recipes/vegetarian-recipes`, `/recipes/seafood-recipes`, `/recipes/meat-recipes`, etc. — seen during exploration) where feasible. Store a manual-override column since heuristics will misfire occasionally.
- Store `totalTime` → minutes, `nutrition.calories` → int, plus rating/cuisine/category/servings/image/source URL.

### Phase 2 — Ingredient normalization
- Raw ingredient text varies across recipes ("Garlic Clove" vs "Garlic Cloves" vs "Garlic"). Build a canonical `Ingredient` table plus an `IngredientAlias` table mapping raw text → canonical ingredient (lowercase, singularize, small hand-curated synonym list, grown as real data is scraped).
- This canonical mapping is what makes "find common ingredients" actually work — overlap must be computed on canonical ingredients, not raw strings.
- **Done**: stripped HelloFresh's "purpose clause" suffixes (e.g. "Water for the Sauce", "Olive Oil for the Dressing") that were fragmenting single pantry staples into dozens of distinct canonical ingredients, and fixed a mass-noun de-pluralization bug ("couscous" → "couscou", "asparagus" → "asparagu", "houmous" → "houmou"). Verified against the 1000-recipe sample: distinct ingredients dropped from 752 to 689, "water" correctly consolidates 594 uses under one row.
- **Deferred to Phase 5**: normalizing common units (g/grams, tbsp/tsp, unit(s)) enough to sum quantities in a shopping list. Not needed until the shopping-list feature itself is built, so picked up there instead of in the abstract now.

### Phase 3 — Query/API layer
- Server actions / route handlers for: paginated + filtered recipe list (protein type, cuisine, calorie range, cook-time range, text search), recipe detail, and "compute shared ingredients + consolidated shopping list" for an arbitrary set of recipe IDs.

### Phase 4 — Card browser UI (hiringcafe-inspired)
Design reference (hiringcafe.com), directly observed:
- A sticky top bar of pill-shaped filter buttons (their equivalent: Date Posted, Salary, Departments; ours: Protein Type, Cuisine, Calories, Cook Time, Diet).
- A compact card grid below: small thumbnail/logo-equivalent, bold title, 2-3 pill tags per card, short description line, result-count + sort control above the grid.
- Recipe cards: HelloFresh image thumbnail, recipe name + the "with ..." subtitle (HelloFresh recipes are named as a two-part title), pill tags for protein type (color-coded), calories, cook time; click-through to a detail view with full ingredients + instructions.

### Phase 5 — Weekly planner
- **Manual mode — done**: "Add to this week" button on each card and the detail page (Server Actions writing to `MealPlan`/`MealPlanRecipe`, a single implicit "current" plan since this is single-user with no auth). A persistent drawer (fixed toggle button + slide-over panel, client shell wrapping server-rendered content) lists selected recipes, highlights canonical ingredients shared across ≥2 of them, and renders a consolidated shopping list with quantities summed per matching (ingredient, unit) pair — true cross-unit conversion (tbsp → ml) is still out of scope; differing units show as separate totals rather than one combined figure. Verified end-to-end in-browser: add/remove, shared-ingredient highlighting, and quantity summing all confirmed correct.
- **Auto-suggest mode — done**: `/suggest?n=3&<same filter params as the browse grid>` — "constraints" turned out not to need dedicated UI, since scoping the candidate pool to the user's *current browse filters* (reusing `buildWhere` directly) already covers "at least 1 vegetarian" (filter to vegetarian first) and similar. Greedily grows a set from a seed recipe, at each step adding whichever candidate shares the most ingredients with the set so far, repeated from ~40 seeds (top-rated + random sample for variety), keeping the top 3 distinct highest-scoring combinations. Deliberately does *not* reuse the IDF-ingredient-weighting from variant detection — a shared common ingredient (onion, garlic) is exactly the win this feature exists to surface, not noise to filter out, unlike the "are these the same recipe" question variant detection answers. "Use this week" bulk-adds a suggested combination and redirects to the drawer. Verified in-browser: suggested combinations were genuinely coherent (e.g. three beef-mince recipes sharing 14 ingredients), and the drawer's shared-ingredient/shopping-list totals after bulk-add matched exactly what the suggestion page predicted.

### Phase 6 — Data resilience: DB snapshots + reprocess-from-cache — done

- `npm run db:snapshot` / `npm run db:restore` wrap `pg_dump -Fc` / `pg_restore --clean --if-exists --no-owner` (stripping Prisma's `?schema=` query param, which plain libpq tools reject). Snapshot lands at `db-backups/refresh.dump` (gitignored, ~14MB for the full catalog). Verified with a real round-trip restore into a scratch database (`refresh_restore_test`) before trusting it.
- `npm run reprocess` (= `scrape --force`) is now the documented path for reapplying any parsing/classification change catalog-wide: the scraper already caches every fetched page's HTML to disk (`.cache/hellofresh/html`), and `readCachedHtml` is checked before any network fetch regardless of `--force` — so a full reprocess of all 16,489 recipes completed with **zero new network requests**. This is how Phases 7, 11, and 12 below will get applied to already-scraped recipes.
- Missing-image visibility fix: `computeIsBrowsable` (`upsertRecipe.ts`) now also requires `hasUsableImage(parsed.imageUrl)` — HelloFresh's own site never shows a recipe tile without a photo, so this was a real gap, not just a display nicety. Reprocessed from cache: 3,918 image-less recipes dropped out of the browsable set (14,033 → 10,115). Re-ran `detect-variants` against the smaller pool afterward (stale `variantOfId` pointers reset first, same as any browsable-set change) — 6,289 recipes now visible. Confirmed in-browser: every card shows a real photo, no placeholder tiles.

### Phase 7 — Protein sub-types & a shared colour system — done

- Split `ProteinType.MEAT` into `CHICKEN`, `TURKEY`, `BEEF`, `LAMB`, `PORK`, `MEAT_OTHER` (duck, venison, rabbit, goat, etc.). `classifyProteinType` now scores per-species keyword matches across a recipe's ingredient lines and picks whichever species has the most matches, tie-broken by a fixed priority order — extending the previous single boolean "hasMeat" check.
- **Found and fixed two real bugs along the way**: (1) species words used purely as a seasoning base ("Chicken Stock Pot", "Fish Stock Cube", "Beef Stock Powder" — 6,400+ ingredient lines across the catalog mention "stock") were counting as protein signals, causing wrong ties ("Tex-Mex Style Pork Enchilada Inspired Lasagne" classified `CHICKEN` off a chicken stock paste despite pork mince being the real protein) and could in principle have forced any dish containing a fish stock cube to `FISH` regardless of its actual protein — fixed by excluding species words immediately followed by stock/bouillon/gravy. (2) "goat" matched regardless of context, so every "Goat's Cheese" ingredient (dairy, not meat) pushed the whole recipe to `MEAT_OTHER` — extended the same exclusion to "cheese", moving 118 recipes back to `VEGETARIAN`.
- **Split Duck and Venison out of `MEAT_OTHER`** once real data showed they *were* the "other meat" bucket — 166 duck + 43 venison, zero rabbit/goat/quail/pheasant/wild boar recipes actually in the catalog. Each got its own `ProteinType` value and colour (Duck rose, Venison amber); `MEAT_OTHER` stays as the fallback for whichever of those still-unseen species turns up on a future re-scrape. Final distribution after all three fixes: Vegetarian 5,024, Chicken 3,206, Pork 2,618, Beef 2,224, Fish 2,074, Lamb 471, Duck 166, Vegan 89, Turkey 86, Venison 43, Meat Other 0.
- Added `PROTEIN_COLORS` (`filterPresets.ts`) as the single source of truth for protein colour — Chicken orange, Turkey purple, Beef red, Lamb dark green, Pork indigo ("dark blue" distinct from Fish's blue), plus Fish/Vegetarian/Vegan/Other/Unknown — used consistently by `RecipeCard` badges, the detail page badge, and now the `FilterBar` pills themselves too (previously always plain black/white regardless of protein type). Verified in-browser: filtering to Beef turns that pill solid red and narrows the grid to all-red-badged beef recipes; the detail page badge matches.
- Split the single "Protein Type" filter into the finer buckets in `FilterBar`.

### Phase 8 — Branding: logo + favicon — done

- Presented 4 candidate icon concepts (leaf+fork fusion, simple leaf, refresh arrows, monogram badge) with rendered SVG previews; you picked leaf + fork fusion — a two-tone leaf whose veins are drawn as fork tines.
- `src/lib/brand/logo.ts` holds the SVG path data as the single source of truth. `Logo.tsx` renders it inline next to the "re:Fresh" title in the header. `scripts/generate-favicon.ts` derives both browser-facing assets from that same source: `src/app/icon.svg` (Next's modern SVG-favicon file convention) and `src/app/favicon.ico` (16/32/48px, rasterized via `sharp`). The `.ico` container itself is hand-packed (~30 lines) rather than pulling in the `to-ico` package, which turned out to drag in an old, vulnerable `jimp`/`request` dependency chain for what's a simple binary format. Verified in-browser: both `<link rel="icon">` tags resolve correctly, `/icon.svg` renders the intended mark, and the header logo displays at the right size next to the title.

### Phase 9 — Favourites — done

- Single-user `isFavourite` boolean on `Recipe` (mirrors the existing single-implicit-`MealPlan` pattern — no auth, no per-user table needed), `toggleFavourite` server action (same shape as `addRecipeToPlan`/`removeRecipeFromPlan`), and a heart icon (outline/filled `HeartIcon`) via `FavouriteToggleButton` — a compact heart-only overlay in the top-right corner of each card's image, and a full labeled button next to "Add to this week" on the detail page.
- A pink "Favourites" toggle pill in `FilterBar`, wired through `buildWhere`/`toListParams`/`searchParamsUtil` the same way every other filter is — so it also scopes the `/suggest` candidate pool automatically, with no extra code.
- Verified end-to-end in-browser: toggling a card's heart persists to the DB, the Favourites filter narrows to exactly that recipe, and the detail page button reflects and toggles the same state.

### Phase 10 — Recipe pool refinements — done

- "Show all recipes" filter pill bypasses the `variantOfId: null` clause in `buildWhere` so detected near-duplicates appear alongside their primary instead of being hidden — `isBrowsable: false` stays excluded regardless, since those are broken stub pages, not "similar recipes." Flows through `toListParams`/`searchParamsUtil` like every other filter, so it also scopes `/suggest`'s candidate pool with no extra wiring. Verified in-browser: a known variant ("Halloumi & Onion Bhaji Fritter Burger and Chips") is invisible to search normally and appears once the toggle is on.
- Auto-suggest no-repeat fix: `suggestMealCombinations` grew each of its ~40 candidate combos independently from the full pool, so the same recipe could easily be the best marginal add for several different seeds and end up in more than one of the 3 returned options. Now takes combos in score-descending order, skipping any that reuse a recipe already claimed by a better one. Verified via script at meal counts 2 through 5: zero repeated recipes across all returned combos.

### Phase 11 — Recipe detail polish — done

- Quantity rationalization: `"unit(s)"`/`"units"`/`"unit"` (HelloFresh's placeholder for "just a count, no real unit") now normalize to no unit at parse time instead of displaying literally ("1 unit(s) Garlic Clove" → "1 Garlic Clove") — also fixes a real shopping-list bug, since the same ingredient tracked as `unit(s)` in one recipe and unitless in another previously summed into two separate totals instead of one combined total. Reprocessed from cache: 29,801 ingredient rows affected.
- Steps layout: each instruction step now gets the same grey-outline `rounded-2xl` card treatment as the ingredients box, with clearer spacing between steps.
- **Found while verifying, fixed the same day**: the "burger" → BEEF ambiguous-cut fallback (added in Phase 7) bypassed the non-protein-context guard entirely, so "Burger Bun(s)" — a bread product, 616 ingredient lines — was forcing recipes like the vegetarian "Onion Bhaji Fritter Burger and Chips" to `BEEF`. Routed the fallback check through the same guard used for species keywords and added "bun" to the suffix list. Reprocessed from cache: 256 recipes moved off `BEEF` to their correct protein.

### Phase 12 — Nutrition information — done

- Extended the JSON-LD nutrition typing/parser to capture fat, saturated fat, carbs, sugar, protein, fibre, and salt (per serving), confirmed against real cached HTML (`schema.org/NutritionInformation` fields, values like `"17.1 g"`). `saltGrams` maps from the JSON-LD's `sodiumContent` field, which HelloFresh actually populates with its own "Salt" label's value in grams rather than sodium-in-milligrams as the field name implies.
- 7 new nullable `Float` columns on `Recipe`, backfilled by reprocessing the full catalog from the disk cache: 99.5% fat/carbs/sugar/protein coverage, 93.9% salt coverage among browsable recipes.
- A Nutrition panel on the recipe detail page, styled to match the ingredients box, listing only the fields actually present for that recipe (omits e.g. Fibre when null rather than showing a blank row). Verified in-browser.

### Phase 13 — Adjustable serving size — done

- `IngredientsPanel`: a 2/3/4-person picker on the recipe detail page that scales every displayed ingredient quantity by `selectedServings / recipe.servings`, entirely client-side (no server round-trip). Every browsable recipe's base `servings` turned out to be exactly 2, so the ratio is simple and reliable in practice; the picker hides itself entirely for the rare recipe with no known base servings.
- `MealPlanRecipe.servings`: a nullable per-plan override (null = use the recipe's own base — the common case, so existing add-to-plan flows needed no changes). `MealPlanServingsSelect` in the plan drawer adjusts it per recipe. `computeSharedIngredients` now takes an optional `servingsOverrides` map and scales each recipe's contribution before summing, so the shopping list (drawer and `/plan/print`) reflects actual serving counts instead of always assuming the raw 2-serving quantities. `/suggest`'s call site needed no changes (no override map = prior behavior).
- **Found and fixed a real bug while verifying**: the servings `<select>` used `defaultValue`, which React only applies on initial mount — after the server action updated the DB and `revalidatePath` refreshed the page, the dropdown kept displaying the old value even though the underlying data (and the shopping-list totals computed from it) were already correct. Fixed with `key={servings}` to force a remount whenever the server value changes.
- Verified end-to-end in-browser: the detail-page picker scales all ingredient lines correctly (2x at 4p), the plan drawer's per-recipe select updates the shopping list correctly (1.5x at 3p) and, after the fix, displays its own current value correctly too.

### Phase 14 — Printable shopping list — done

- `/plan/print` server-renders the consolidated shopping list (reusing `computeSharedIngredients`) as a checklist: bigger rows, a checkbox square per line for ticking off on paper, `print:hidden` on everything that isn't the list itself. Linked from the plan drawer's "Shopping list" section, opening in a new tab. `PrintButton` (a small client component wrapping `window.print()`) is shared between this page and the recipe detail page.
- Extended beyond the original scope on request: every recipe detail page also got a Print button next to "Add to this week"/"Add to favourites", with the header, nav links, action buttons, and "Similar variants" section all `print:hidden` so a printed recipe shows just the recipe — title, image, badges, description, ingredients, nutrition, and instructions. The root layout's header and floating "This week" button are `print:hidden` globally, so no page anywhere prints the app chrome. Verified in-browser on both pages.

### Phase 15 — Custom recipes (clone & edit) — done

- "Clone & customize" on the recipe detail page duplicates a `Recipe` row plus its `RecipeIngredient` rows (steps/nutrition/image copied as-is) and redirects straight to `/recipes/[slug]/edit`. `hfId` uses a synthetic `custom-<uuid>` so no schema relaxation was needed there; `sourceUrl` is inherited from the clone origin as a provenance record.
- Schema: `isUserCreated Boolean` + a `clonedFromId` self-relation, deliberately separate from `variantOfId` (which `detect-variants.ts` wipes and recomputes wholesale on every run — reusing it here would silently erase clone provenance).
- Extracted the scraper's alias-lookup → canonicalize → get-or-create ingredient-resolution logic out of `upsertRecipe.ts` into a shared `src/lib/recipes/ingredientResolution.ts`, so the editor's add-ingredient form resolves a user-typed "Garlic Clove" to the exact same canonical ingredient the scraper would have produced, rather than forking into a duplicate. `addCustomIngredient`/`removeCustomIngredient` both guard against editing a non-`isUserCreated` recipe and re-run `classifyProteinType` on every change.
- Nutrition panel shows an "inherited from the original recipe" disclaimer on custom recipes rather than silently showing stale numbers, since there's no per-ingredient nutrition data to recompute from as ingredients change.
- "My recipe" badge on cards and the detail page.
- `npm run reprocess` needed no changes, confirmed — it only ever upserts by `hfId` against cached HTML.
- Verified end-to-end in-browser: clone → redirected to editor → removed an ingredient → added "Chicken Breast" → protein type correctly re-derived Vegetarian → Chicken → detail page shows the badge, updated ingredients, and the nutrition disclaimer → shows correctly in the browse grid too.
- Initial cut is ingredients-only, per the original request. Editing steps/instructions, cook time, servings, etc. is a natural follow-on if wanted later.

### Phase 16 — Multi-household auth — code done, production rollout pending

- The app was single-user/no-auth by design through Phase 15 (`isFavourite`/`isHidden` as plain booleans on `Recipe`, one implicit `MealPlan` — see those phases' notes). Goal: let multiple households sign in independently and share the same recipe catalog while keeping their own favourites, hidden list, and this-week plan separate.
- Modelled directly on a sibling project's own Better Auth + household migration (jinglejotter.com's Multi-Tenancy work), adapted for the one structural difference: there, household-owned domain models just grew a `householdId` column; here, `Recipe`/`Ingredient` had to stay shared/global (every household browses the same catalog), so per-household favourite/hidden/suggestion-cooldown state moved into a new join table, `HouseholdRecipeState(householdId, recipeId, isFavourite, isHidden, lastSuggestedAt)`, rather than adding an owner column to `Recipe` itself. `MealPlan` did just grow a `householdId` (mirrors the sibling project's `Season`) — one implicit "current" plan per household, same pattern as before, just re-scoped.
- Auth: Better Auth, Google OAuth + magic link (Resend, `refresh.markrwatts.com`), the `organization` plugin renamed to `Household`/`Member`/`Invitation`. Sign-in is fully open (no email allowlist) — household membership itself is the real gate, since the whole point is letting arbitrary future households use the shared catalog, not just this one. `src/lib/require-member.ts`'s `requireMember()`/`requireMemberOrRedirect()` is the scoping choke point every mutating action and protected page goes through.
- Migration: two-step (nullable `MealPlan.householdId` + new tables first, `scripts/backfill-household.ts` creates a household and copies existing global favourite/hidden/plan data into it, then a second migration makes `householdId` required and drops the old `Recipe` columns) — verified end-to-end against a local copy of the real dev data (16,496 recipes, 3 pre-existing meal-plan rows, 18 recipes with suggestion history) before being written up as the production rollout steps in `DEPLOYMENT.md`.
- **Found and fixed a real bug while verifying**: redirecting straight to `/` right after a state change that only the root layout's own render reflects (gaining a household, signing out) left the header stale — no "This week" badge, or still showing "Account/Sign out" after signing out — until a hard reload, because Next's shared-layout partial rendering doesn't re-run the root layout's own top-level code on a same-layout client navigation (only the page content below it). Fixed by adding `revalidatePath("/", "layout")` before those specific redirects, matching the pattern the meal-plan actions already used. Confirmed via two-browser-session testing (separate local households never saw each other's favourites/hidden recipes/plan, while both saw the identical 6,296-recipe catalog) that this was the only staleness gap — every other mutating action already revalidated correctly.
- Also caught in verification: the Better Auth API route handler (`src/app/api/auth/[...all]/route.ts`) was initially missing entirely — sign-in 404'd until added. A reminder that "the auth library is configured" and "the auth library is actually wired into the app's routing" are two different, both-necessary steps.
- **Not done — needs Mark, can't be done unattended**: the actual Google Cloud OAuth client and Resend domain verification (started — `_dmarc.refresh.markrwatts.com` DNS record added), and running the real production migration + backfill against the live VM once those exist. See `DEPLOYMENT.md`'s "Multi-household auth (Phase 16)" section for the exact steps.

## Data model (Prisma sketch)

- `Recipe(id, hfId, slug, name, subtitle, imageUrl, cookMinutes, servings, calories, proteinType, cuisine, category, ratingValue, ratingCount, sourceUrl, lastScrapedAt)`
- `Ingredient(id, canonicalName, category)` — category e.g. produce/dairy/protein/pantry, for shopping-list grouping.
- `IngredientAlias(id, ingredientId, rawText)`
- `RecipeIngredient(id, recipeId, ingredientId, quantity, unit, rawText)`
- `MealPlan(id, label, createdAt, householdId)`, `MealPlanRecipe(mealPlanId, recipeId)` — household-owned as of Phase 16 (was global before).
- `User`/`Account`/`Session`/`Verification` (Better Auth core), `Household`/`Member`/`Invitation` (Better Auth's organization plugin, renamed) — Phase 16.
- `HouseholdRecipeState(id, householdId, recipeId, isFavourite, isHidden, lastSuggestedAt)` — Phase 16; replaces the `isFavourite`/`isHidden`/`lastSuggestedAt` fields `Recipe` carried through Phase 15, since the catalog itself stays shared across households.

## Verification

- Scraper: run against ~50 sitemap URLs first; manually diff parsed output against 3-4 live recipe pages (including one with unusual ingredient phrasing) before running the full 16k crawl.
- UI: run the dev server, confirm filters narrow the grid correctly, and spot-check protein-type classification against ~20 diverse recipes (cross-check a few against the site's own vegetarian/seafood/meat collection pages).
- Planner: manually select 3 recipes with known-overlapping ingredients (e.g. all use onion + garlic) and confirm the shared-ingredients panel and summed shopping-list quantities are correct.

## Full crawl

Ran the scraper against the entire sitemap (16,490 URLs) rather than a sample: 15,489 newly scraped this run + the earlier 1,000-recipe sample already cached, 1 genuine error (a sitemap entry that redirects to a non-recipe food-box page), 14,033 recipes browsable (85%). The oldest ~450 sitemap entries turned out to be stub/testing pages (0 ingredients, e.g. `gnocchi-5252b1f5301bbff2428b4764`) from HelloFresh's early years — already correctly excluded by the existing `isBrowsable` rule, no fix needed.

**Found and fixed a real bug at this scale**: re-running `detect-variants` against the full catalog collapsed HALF of the browsable recipes into a handful of superclusters (e.g. one "Asian Inspired Rice" cluster pulled in an unrelated "MCB Pork Meatball Curry"). Root cause: the union-find clustering was transitive (single-linkage) — A~B~C merges A and C into one cluster even when A and C share almost nothing directly. That's invisible at a ~1,000-recipe tuning sample (too few chains to matter) but guaranteed to blow up at 14k+ recipes, since chain probability grows with catalog size for any fixed threshold — raising the threshold again would only have deferred the same failure to an even larger catalog. Replaced it with direct-to-primary ("star") clustering in `variantDetection.ts`: recipes are considered as primaries in completeness order, and a recipe only becomes a variant of a primary it is *itself* directly over-threshold with — never through an intermediate. This eliminates the failure mode structurally rather than by threshold-tuning. Verified against three known cases post-fix: the false Asian-rice/Onion-Bhaji chains are gone, the previously-confirmed buffalo-chicken pair and Hotteok typo-pair still cluster correctly, and a case that looked like a new false positive by name ("MCB Pork Meatball Curry") turned out to be a genuine 88% ingredient overlap on inspection (same base dish, obscured by an unrelated display name) — same pattern as the original buffalo-chicken calibration case. Net result: 5,961 of 14,033 browsable recipes (42%) are flagged as variants, leaving 8,072 visible — plausible for a 13-year weekly-menu catalog that reuses "hero" components under many names, per the feature's own original hypothesis.

## Open items to revisit later

- Hosting is deferred — Docker Postgres keeps the project portable to Neon/Fly/a VPS whenever you decide.
- Protein-type classification is heuristic; expect to refine keyword lists after seeing real misclassifications in scraped data.
- Auto-suggest optimizer performance over the full catalog vs. a scoped candidate pool — start scoped, widen later if needed.
- Variant-detection threshold (minShared=6, similarity=0.8) is still a heuristic tuned by spot-checking, not exhaustively validated — worth revisiting if more false positives/negatives turn up during normal use.
- **Fixed**: "Back to recipes" links (recipe detail, `/suggest`, `/plan/print`) were all hardcoded `href="/"`, dropping active filters/search/page. Replaced with a shared `BackLink` client component (`router.back()`, falling back to a fresh `/` push if there's no browser history). Verified in-browser.
