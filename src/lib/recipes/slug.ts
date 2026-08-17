import { prisma } from "@/lib/db";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 2;
  while (await prisma.recipe.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}
