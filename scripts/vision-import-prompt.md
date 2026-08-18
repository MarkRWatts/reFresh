# HelloFresh card vision-import runbook

Paste this whole document as your first message to a fresh Claude Code
session opened on the **reFresh** repo (typically
`/Users/mark/claude-code/reFresh`). It's fully self-contained — you don't
need any other context from wherever this file came from.

## What you're doing

Scanned HelloFresh recipe-card PDFs sit in `storage/pdf-import/inbox/`. For
each one, you'll: render its two pages as images, read them yourself (you
have vision — use it, don't shell out to any OCR tool or external API), write
what you read into a small JSON file plus some cropped photos, then run a
script that commits it straight into the Postgres database as a real,
browsable recipe. **There is no review step** — whatever you write into the
JSON becomes the live recipe, so read carefully and double-check numbers
before committing each one.

Do not write a script that calls the Anthropic API to do the reading for
you — the whole point of doing this from inside a Claude Code session is
that the reading is done by you, directly, at no metered API cost. Bash,
Read, and Write are all you need; you won't need Edit on any source file.

## One-time setup (skip anything already present)

```bash
which pdftoppm || brew install poppler
mkdir -p storage/pdf-import/{inbox,staging,done,failed}
test -d storage/pdf-import/.venv || python3 -m venv storage/pdf-import/.venv
storage/pdf-import/.venv/bin/pip show Pillow >/dev/null 2>&1 || storage/pdf-import/.venv/bin/pip install --quiet Pillow
```

## Per-card procedure

Repeat this for every `*.pdf` in `storage/pdf-import/inbox/`. Do them one at
a time — don't try to batch the vision-reading across multiple cards in one
pass, accuracy matters more than speed here.

### 1. Render the pages

```bash
mkdir -p storage/pdf-import/staging/<slug>
pdftoppm -r 300 -png "storage/pdf-import/inbox/<file>.pdf" storage/pdf-import/staging/<slug>/page
```

`<slug>` is just a kebab-case version of the recipe's name for a readable
folder name — it does not need to match the final URL slug, the commit
script generates that itself. This produces `page-1.png` (front, cover
photo) and `page-2.png` (ingredients/method/nutrition).

### 2. Read page 1 with the Read tool

Look at `page-1.png` directly (Read tool, not a text extractor) and note:
recipe name, subtitle (the "with ..." part), total time in minutes, and the
serving-size columns the card offers (usually 2P/3P/4P, sometimes just one
size). Then crop the cover hero photo out of the page with Pillow — locate
its bounding box by eye the same way you'd eyeball any other image crop, no
fixed coordinates will work across different card layouts:

```bash
storage/pdf-import/.venv/bin/python3 - <<'EOF'
from PIL import Image
im = Image.open("storage/pdf-import/staging/<slug>/page-1.png")
im.crop((left, top, right, bottom)).save("storage/pdf-import/staging/<slug>/cover.png")
EOF
```

### 3. Read page 2 with the Read tool

Look at `page-2.png` directly and transcribe:
- **Ingredients**: every row, with quantity + unit for each serving-size
  column (not just the first). Keep names as printed on the card (e.g.
  "Ketjap Manis", not "ketjap manis sauce") — the app normalizes/aliases
  names itself downstream.
- **Steps**: every numbered step's heading and full instruction text, in
  order. Some older card layouts have no per-step photos, or run the steps
  as flowing paragraphs with no fixed heading — that's fine, see the schema
  below.
- **Nutrition**: calories, fat, saturated fat, carbs, sugar, protein, salt,
  fibre — per serving. Leave a field `null` if the card doesn't print it
  (don't guess).

Crop each step's photo the same way as the cover (one Pillow call per step,
or one script with several crops) — again, locate each grid cell by eye
rather than assuming fixed positions, since layouts vary across cards.

### 4. Write `data.json`

Save this into `storage/pdf-import/staging/<slug>/data.json`, matching the
`VisionCardData` type in
[`src/lib/pdfImport/commitVisionImport.ts`](../src/lib/pdfImport/commitVisionImport.ts)
exactly (read that file if anything below is ambiguous):

```json
{
  "name": "Teriyaki Beef Mince",
  "subtitle": "with Jasmine Rice and Cucumber Salad",
  "cookMinutes": 35,
  "servingCounts": [2, 3, 4],
  "coverPhotoFile": "cover.png",
  "ingredients": [
    {
      "name": "Garlic Clove",
      "byServing": [
        { "quantity": 2, "unit": "cloves", "rawText": "2 cloves" },
        { "quantity": 3, "unit": "cloves", "rawText": "3 cloves" },
        { "quantity": 4, "unit": "cloves", "rawText": "4 cloves" }
      ]
    }
  ],
  "steps": [
    {
      "heading": "Get Prepped",
      "text": "Peel and grate the garlic...",
      "photoFile": "step-1.png"
    }
  ],
  "calories": 747,
  "fatGrams": 29,
  "saturatedFatGrams": 9,
  "carbsGrams": 87,
  "sugarGrams": 24,
  "proteinGrams": 34,
  "saltGrams": 3.11,
  "fiberGrams": null
}
```

Notes:
- `byServing` must have one entry per `servingCounts` index, in the same
  order. A single-serving-size card just has `servingCounts: [X]` and a
  one-entry `byServing` array per ingredient.
- A step with no photo on the card gets `"photoFile": null`.
- File paths (`coverPhotoFile`, each step's `photoFile`) are plain filenames
  relative to the staging directory — call them whatever you cropped them
  as, they don't need to be renamed to a fixed convention.
- There's no allergens field — the app's `Recipe` model doesn't track that,
  so don't invent one.

### 5. Commit it

```bash
npm run commit-vision-import -- storage/pdf-import/staging/<slug>
```

This prints the new recipe's URL on success. It exits non-zero (and writes
nothing) if `data.json` is missing a name, ingredients, or steps entirely —
that's a sanity check, not full validation, so it will happily commit wrong
numbers if you transcribed them wrong. Re-read your JSON against the card
images once before running this, especially the nutrition figures and
serving quantities.

### 6. Clean up

On success:
```bash
rm -rf storage/pdf-import/staging/<slug>
mv "storage/pdf-import/inbox/<file>.pdf" storage/pdf-import/done/
```

On failure, or if you're genuinely unsure about a figure you can't read
clearly from the scan (smudged print, cut-off edge, unfamiliar layout):
leave the staging dir as-is for inspection and move the PDF to
`storage/pdf-import/failed/` instead, with a one-line note in
`storage/pdf-import/failed/<file>.txt` on what was uncertain. Don't guess at
a number you can't actually read — `null` it and note it instead.

## When you're done

Report a short summary: how many committed, how many failed and why, and
the recipe URLs for anything you weren't fully confident about so it can be
spot-checked.
