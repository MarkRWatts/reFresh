import Image from "next/image";

/** A plain labeled text/number input, styled consistently across every recipe-editing form (PDF import review, the recipe editor). */
export function TextField({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        step={type === "number" ? "any" : undefined}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}

/** The exact crop OCR read a field from, shown alongside it so a misread is easy to spot at a glance — see imageStorage.ts's ingredients.png/nutrition.png/step-N-text.png. Renders nothing when there's no crop to show (e.g. editing an already-committed recipe, where these crops don't survive past the import draft — see promoteDraftImages). */
export function SourceCropPreview({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) return null;
  return (
    <div className="relative mb-2 h-16 w-full max-w-md overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
      <Image src={src} alt={alt} fill sizes="28rem" className="object-contain" />
    </div>
  );
}

export interface NutritionFieldValues {
  calories: number | null;
  fatGrams: number | null;
  saturatedFatGrams: number | null;
  carbsGrams: number | null;
  sugarGrams: number | null;
  proteinGrams: number | null;
  saltGrams: number | null;
  fiberGrams: number | null;
}

const NUTRITION_DISPLAY_FIELDS = [
  ["Calories", "calories", ""],
  ["Fat", "fatGrams", "g"],
  ["Saturates", "saturatedFatGrams", "g"],
  ["Carbs", "carbsGrams", "g"],
  ["Sugar", "sugarGrams", "g"],
  ["Protein", "proteinGrams", "g"],
  ["Salt", "saltGrams", "g"],
  ["Fibre", "fiberGrams", "g"],
] as const;

/** The 8-field per-serving nutrition grid, shared between the PDF import review screen and the recipe editor — same fields either way, since Recipe stores them as flat per-serving columns with no separate Nutrition model. */
export function NutritionFieldsSection({
  nutrition,
  sourceCropUrl,
  withOptionalIngredient,
}: {
  nutrition: NutritionFieldValues;
  sourceCropUrl?: string | null;
  /** A second reading off a card's "Custom Recipe" swap block (see parseCardPdf.ts) — reference-only, never saved, so the user can see which of the two sets actually applies to what they're cooking. Only ever present on the PDF import review screen. */
  withOptionalIngredient?: NutritionFieldValues | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Nutrition (per serving)</h2>
      <SourceCropPreview src={sourceCropUrl} alt="Nutrition, as scanned" />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextField label="Calories" name="calories" type="number" defaultValue={nutrition.calories ?? ""} />
        <TextField label="Fat (g)" name="fatGrams" type="number" defaultValue={nutrition.fatGrams ?? ""} />
        <TextField label="Saturates (g)" name="saturatedFatGrams" type="number" defaultValue={nutrition.saturatedFatGrams ?? ""} />
        <TextField label="Carbs (g)" name="carbsGrams" type="number" defaultValue={nutrition.carbsGrams ?? ""} />
        <TextField label="Sugar (g)" name="sugarGrams" type="number" defaultValue={nutrition.sugarGrams ?? ""} />
        <TextField label="Protein (g)" name="proteinGrams" type="number" defaultValue={nutrition.proteinGrams ?? ""} />
        <TextField label="Salt (g)" name="saltGrams" type="number" defaultValue={nutrition.saltGrams ?? ""} />
        <TextField label="Fibre (g)" name="fiberGrams" type="number" defaultValue={nutrition.fiberGrams ?? ""} />
      </div>

      {withOptionalIngredient && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            This card also has a second nutrition column, likely for an optional/swappable
            ingredient (see the warning above). These figures aren&rsquo;t saved anywhere;
            they&rsquo;re shown for reference only, in case they&rsquo;re the ones that apply to
            what you&rsquo;re cooking.
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-amber-900 sm:grid-cols-4">
            {NUTRITION_DISPLAY_FIELDS.map(([label, key, unit]) => {
              const value = withOptionalIngredient[key];
              return (
                <div key={key} className="flex justify-between gap-1">
                  <dt>{label}</dt>
                  <dd className="font-medium">
                    {value ?? "?"}
                    {value != null ? unit : ""}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}

export interface EditableStep {
  heading: string | null;
  text: string;
}

/** The steps list, shared between the PDF import review screen and the recipe editor. Each step's own photo (if any) is shown but not replaceable — there's no upload widget yet (see edit/page.tsx), so a step's image just carries through unchanged. `showHeading` is off for an already-committed recipe: its steps were saved as one combined text blob (see commitImport.ts), with no heading tracked separately to re-populate a heading field from. */
export function StepsFieldsSection({
  steps,
  stepImageUrls,
  stepTextImageUrls,
  showHeading = true,
}: {
  steps: EditableStep[];
  stepImageUrls?: (string | null)[];
  stepTextImageUrls?: (string | null)[];
  showHeading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Steps ({steps.length})</h2>
      <p className="mt-1 text-xs text-zinc-500">Clear a step&rsquo;s instructions to drop it.</p>
      <div className="mt-3 space-y-4">
        {steps.map((step, i) => {
          const photoUrl = stepImageUrls?.[i];
          const textCropUrl = stepTextImageUrls?.[i];
          return (
            <div key={i} className="flex gap-3 border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0">
              {photoUrl && (
                <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                  <Image src={photoUrl} alt={`Step ${i + 1}`} fill sizes="7rem" className="object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-2">
                {showHeading && <TextField label="Heading" name="stepHeading" defaultValue={step.heading ?? ""} />}
                <SourceCropPreview src={textCropUrl} alt={`Step ${i + 1} text, as scanned`} />
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">Instructions</span>
                  <textarea
                    name="stepText"
                    defaultValue={step.text}
                    rows={3}
                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
