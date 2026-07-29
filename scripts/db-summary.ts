import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const total = await prisma.recipe.count();
  const byProtein = await prisma.recipe.groupBy({
    by: ["proteinType"],
    _count: true,
  });
  console.log("Total recipes:", total);
  console.log("By protein type:", byProtein);

  const sample = await prisma.recipe.findMany({
    take: 2,
    where: { calories: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { ingredients: { include: { ingredient: true } } },
  });

  for (const r of sample) {
    console.log(`\n=== ${r.name} ===`);
    console.log({
      subtitle: r.subtitle,
      cookMinutes: r.cookMinutes,
      servings: r.servings,
      calories: r.calories,
      proteinType: r.proteinType,
      cuisine: r.cuisine,
      category: r.category,
      ratingValue: r.ratingValue,
      ratingCount: r.ratingCount,
      sourceUrl: r.sourceUrl,
    });
    console.log(
      "ingredients:",
      r.ingredients.map((i) => `${i.quantity ?? "?"} ${i.unit ?? ""} ${i.ingredient.canonicalName}`.trim()),
    );
  }

  await prisma.$disconnect();
}

main();
