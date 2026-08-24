"use server";

import { prisma } from "@/lib/db";

export interface IngredientOption {
  id: string;
  canonicalName: string;
}

const MAX_RESULTS = 12;

/**
 * Autocomplete lookup for the pantry-match ingredient picker. Matches
 * against canonical names and known aliases, but — unlike
 * resolveIngredientId (ingredientResolution.ts) — never creates a new
 * ingredient/alias for unmatched text, since this is search-only: a typo
 * or unrecognized ingredient should just show no suggestions, not silently
 * mint a new canonical ingredient nothing else uses.
 */
export async function searchIngredients(query: string): Promise<IngredientOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  return prisma.ingredient.findMany({
    where: {
      OR: [
        { canonicalName: { contains: q, mode: "insensitive" } },
        { aliases: { some: { rawText: { contains: q, mode: "insensitive" } } } },
      ],
    },
    select: { id: true, canonicalName: true },
    orderBy: { canonicalName: "asc" },
    take: MAX_RESULTS,
  });
}
