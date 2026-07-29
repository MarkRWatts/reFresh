export type ProteinType = "MEAT" | "FISH" | "VEGETARIAN" | "VEGAN" | "UNKNOWN";

// Terms that mean "this ingredient is a meat/fish substitute", so their
// presence should NOT trigger a meat/fish match (e.g. "meat-free mince").
const VEGETARIAN_OVERRIDE_TERMS = [
  "meat-free",
  "meat free",
  "plant-based",
  "plant based",
  "plant mince",
  "meatless",
  "veggie mince",
  "quorn",
  "vivera",
  "linda mccartney",
];

const MEAT_KEYWORDS = [
  "chicken",
  "beef",
  "pork",
  "lamb",
  "bacon",
  "sausage",
  "chorizo",
  "turkey",
  "duck",
  "venison",
  "mince",
  "gammon",
  "ham",
  "meatball",
  "steak",
  "pancetta",
  "prosciutto",
  "salami",
  "veal",
  "rabbit",
  "goat",
];

// Includes every species in HelloFresh's own seafood-recipe collection
// pages (Salmon, Cod, Hake, Prawn, Basa, Haddock, Crab, Coley, Sea Bream,
// Seabass, Tilapia, Monkfish, Scallops, Tuna, Whiting), plus other common
// species/terms worth covering.
const FISH_KEYWORDS = [
  "salmon",
  "cod",
  "tuna",
  "prawn",
  "shrimp",
  "haddock",
  "basa",
  "hake",
  "tilapia",
  "sea bass",
  "seabass",
  "bream",
  "barramundi",
  "trout",
  "mackerel",
  "anchovy",
  "crab",
  "scallop",
  "monkfish",
  "coley",
  "whiting",
  "seafood",
  "fish",
  "kipper",
  "sardine",
  "pollock",
  "plaice",
  "sole",
  "swordfish",
  "snapper",
  "mahi",
  "eel",
  "lobster",
  "mussel",
  "oyster",
  "squid",
  "octopus",
  "langoustine",
  "crayfish",
  "clam",
];

function hasKeyword(haystack: string, keyword: string): boolean {
  if (keyword.includes(" ")) return haystack.includes(keyword);
  // Allow simple plurals ("prawn"/"prawns", "sausage"/"sausages") without
  // false-matching unrelated words that merely start with the keyword.
  return new RegExp(`\\b${keyword}(e?s)?\\b`).test(haystack);
}

export interface ProteinTypeInput {
  ingredientNames: string[];
  name?: string;
  category?: string;
  cuisine?: string;
}

/**
 * Keyword heuristic classifying a recipe as MEAT/FISH/VEGETARIAN/VEGAN.
 * The JSON-LD HelloFresh publishes doesn't carry a dietary-type field
 * directly, so this infers it from ingredient text — expected to be
 * refined once real misclassifications are visible (see project plan).
 */
export function classifyProteinType(input: ProteinTypeInput): ProteinType {
  const metaText = [input.name, input.category, input.cuisine]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (input.ingredientNames.length === 0) return "UNKNOWN";

  let hasMeat = false;
  let hasFish = false;

  for (const rawName of input.ingredientNames) {
    const n = rawName.toLowerCase();
    if (VEGETARIAN_OVERRIDE_TERMS.some((term) => n.includes(term))) continue;
    if (FISH_KEYWORDS.some((k) => hasKeyword(n, k))) hasFish = true;
    if (MEAT_KEYWORDS.some((k) => hasKeyword(n, k))) hasMeat = true;
  }

  if (hasFish) return "FISH";
  if (hasMeat) return "MEAT";
  if (/\bvegan\b/.test(metaText)) return "VEGAN";
  return "VEGETARIAN";
}
