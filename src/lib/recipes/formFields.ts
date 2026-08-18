import { parseLeadingQuantity } from "@/lib/scraper/ingredientParser";

/** Reads a numeric form field, treating blank/unparseable input as "not set" rather than 0 — used across every editable-recipe form (PDF import review, the recipe editor) for nutrition/cook-time fields where 0 and "unknown" mean different things. */
export function numberField(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export interface EditedIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
}

/** Reads a form's repeated ingredientName/ingredientQuantity/ingredientUnit fields into rows — shared convention across the PDF import review form and the recipe editor: clearing a row's name is how it gets dropped, and a blank trailing row is how a new one gets added. */
export function readEditedIngredients(formData: FormData): EditedIngredient[] {
  const names = formData.getAll("ingredientName");
  const quantities = formData.getAll("ingredientQuantity");
  const units = formData.getAll("ingredientUnit");
  const rows: EditedIngredient[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] ?? "").trim();
    if (!name) continue;
    const quantityRaw = String(quantities[i] ?? "").trim();
    rows.push({
      name,
      quantity: quantityRaw ? parseLeadingQuantity(quantityRaw) : null,
      unit: String(units[i] ?? "").trim() || null,
    });
  }
  return rows;
}

export interface EditedStep {
  heading: string;
  text: string;
  imageUrl: string | null;
}

/** Reads a form's repeated stepHeading/stepText fields into rows, pairing each against its existing photo URL by position (see stepImageUrls) — there's no upload widget yet, so a step's photo is carried through unchanged rather than editable. Clearing a step's text drops that row, same add/remove convention as readEditedIngredients. */
export function readEditedSteps(formData: FormData, stepImageUrls: (string | null)[]): EditedStep[] {
  const headings = formData.getAll("stepHeading");
  const texts = formData.getAll("stepText");
  const steps: EditedStep[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] ?? "").trim();
    if (!text) continue;
    steps.push({
      heading: String(headings[i] ?? "").trim(),
      text,
      imageUrl: stepImageUrls[i] ?? null,
    });
  }
  return steps;
}
