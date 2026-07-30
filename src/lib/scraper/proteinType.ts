export type ProteinType =
  | "CHICKEN"
  | "TURKEY"
  | "BEEF"
  | "LAMB"
  | "PORK"
  | "DUCK"
  | "VENISON"
  | "MEAT_OTHER"
  | "FISH"
  | "VEGETARIAN"
  | "VEGAN"
  | "UNKNOWN";

type MeatSpecies = "CHICKEN" | "TURKEY" | "BEEF" | "LAMB" | "PORK" | "DUCK" | "VENISON" | "MEAT_OTHER";

// Terms that mean "this ingredient is a meat/fish substitute", so their
// presence should NOT trigger a meat/fish match (e.g. "meat-free mince").
const VEGETARIAN_OVERRIDE_TERMS = [
  "vegan",
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

// Words that identify a species on their own, wherever they appear.
const SPECIES_KEYWORDS: Record<MeatSpecies, string[]> = {
  CHICKEN: ["chicken", "poussin"],
  TURKEY: ["turkey"],
  BEEF: ["beef", "veal", "brisket", "sirloin", "oxtail", "ox cheek"],
  LAMB: ["lamb", "mutton"],
  PORK: [
    "pork",
    "bacon",
    "gammon",
    "ham",
    "pancetta",
    "prosciutto",
    "chorizo",
    "salami",
    "pepperoni",
    "nduja",
  ],
  DUCK: ["duck"],
  VENISON: ["venison"],
  MEAT_OTHER: ["rabbit", "goat", "quail", "pheasant", "wild boar"],
};

// Cut/prep words that say nothing about species by themselves ("mince",
// "sausage") — only used if the ingredient string doesn't already match one
// of the SPECIES_KEYWORDS above, falling back to whichever species that cut
// is most commonly sold as on HelloFresh UK.
const AMBIGUOUS_CUT_FALLBACKS: { keyword: string; species: MeatSpecies }[] = [
  { keyword: "mince", species: "BEEF" },
  { keyword: "steak", species: "BEEF" },
  { keyword: "meatball", species: "BEEF" },
  { keyword: "burger", species: "BEEF" },
  { keyword: "sausage", species: "PORK" },
  { keyword: "escalope", species: "CHICKEN" },
];

// Tie-break order when an ingredient list matches more than one species
// (whichever species has the most matching ingredient lines wins; ties go
// to whichever comes first here).
const SPECIES_PRIORITY: MeatSpecies[] = [
  "CHICKEN",
  "BEEF",
  "PORK",
  "LAMB",
  "TURKEY",
  "DUCK",
  "VENISON",
  "MEAT_OTHER",
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

// A species word immediately followed by one of these means the word isn't
// actually indicating that species' meat: "Chicken Stock Pot"/"Fish Stock
// Cube"/"Beef Stock Powder" are near-universal seasoning pantry items used
// in dishes of every protein (a splash of chicken stock in a pork dish
// shouldn't count as a chicken signal, and a fish stock cube shouldn't
// force the whole dish to FISH — confirmed against real data: "stock"
// alone appears on 6,400+ ingredient lines across the catalog), and "cheese"
// catches dairy products named after an animal rather than its meat (e.g.
// "Goat's Cheese Baguette" was wrongly classified MEAT_OTHER off "goat").
const NON_PROTEIN_CONTEXT_SUFFIXES = ["stock", "bouillon", "gravy", "cheese"];

function isNonProteinContextMention(n: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}('s)?\\s+(${NON_PROTEIN_CONTEXT_SUFFIXES.join("|")})\\b`).test(n);
}

function matchesKeyword(n: string, keyword: string): boolean {
  return hasKeyword(n, keyword) && !isNonProteinContextMention(n, keyword);
}

/** Which species (if any) a single ingredient line identifies. */
function classifyIngredientSpecies(n: string): MeatSpecies | null {
  for (const [species, keywords] of Object.entries(SPECIES_KEYWORDS) as [MeatSpecies, string[]][]) {
    if (keywords.some((k) => matchesKeyword(n, k))) return species;
  }
  for (const { keyword, species } of AMBIGUOUS_CUT_FALLBACKS) {
    if (hasKeyword(n, keyword)) return species;
  }
  return null;
}

export interface ProteinTypeInput {
  ingredientNames: string[];
  name?: string;
  category?: string;
  cuisine?: string;
}

/**
 * Keyword heuristic classifying a recipe's dominant protein. The JSON-LD
 * HelloFresh publishes doesn't carry a dietary-type field directly, so this
 * infers it from ingredient text — expected to be refined once real
 * misclassifications are visible (see project plan). Fish takes priority
 * over meat when both appear (matches the previous MEAT/FISH behavior);
 * among meat species, whichever has the most matching ingredient lines
 * wins, tie-broken by SPECIES_PRIORITY.
 */
export function classifyProteinType(input: ProteinTypeInput): ProteinType {
  const metaText = [input.name, input.category, input.cuisine]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (input.ingredientNames.length === 0) return "UNKNOWN";

  const speciesCounts = new Map<MeatSpecies, number>();
  let hasFish = false;
  let hasVeganMarker = /\bvegan\b/.test(metaText);

  for (const rawName of input.ingredientNames) {
    const n = rawName.toLowerCase();
    if (/\bvegan\b/.test(n)) hasVeganMarker = true;
    if (VEGETARIAN_OVERRIDE_TERMS.some((term) => n.includes(term))) continue;
    if (FISH_KEYWORDS.some((k) => matchesKeyword(n, k))) hasFish = true;

    const species = classifyIngredientSpecies(n);
    if (species) speciesCounts.set(species, (speciesCounts.get(species) ?? 0) + 1);
  }

  if (hasFish) return "FISH";

  if (speciesCounts.size > 0) {
    let best: MeatSpecies = SPECIES_PRIORITY[0];
    let bestCount = -1;
    for (const species of SPECIES_PRIORITY) {
      const count = speciesCounts.get(species) ?? 0;
      if (count > bestCount) {
        bestCount = count;
        best = species;
      }
    }
    return best;
  }

  if (hasVeganMarker) return "VEGAN";
  return "VEGETARIAN";
}
