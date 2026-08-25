// One-off: creates the first Household and attaches every existing
// favourite/hidden/suggested Recipe row (into the new HouseholdRecipeState
// join table) and every existing MealPlan row to it. Needed because those
// were global/single-implicit-owner before households existed — see
// prisma/schema.prisma and project-plan.md Phase 16.
//
// Must run in the WINDOW between the two migrations that make this
// possible: MealPlan.householdId has to exist but still be nullable when
// this runs (prisma/migrations/*_add_household_and_auth), and gets made
// required immediately after (prisma/migrations/*_require_household_
// scoping) — that's why the MealPlan update below is a raw query rather
// than a typed Prisma call: the schema checked into this repo has
// householdId required, so the generated client has no typed way to
// express "still null" even though that's the real, transient shape of the
// database while this runs. Recipe.isFavourite/isHidden/lastSuggestedAt
// are also dropped by that same final migration — this script is the last
// thing that ever reads them.
//
// Safe to run at most once per environment: it's a no-op (prints a message
// and exits) if any Household already exists.
//
// Usage: npx tsx scripts/backfill-household.ts <householdName> <ownerEmail> [memberEmail...]
// Every listed email must already have a User row — i.e. everyone must
// have signed in at least once (Google or magic link) before this runs.
import "dotenv/config";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/recipes/slug";

const [householdName, ownerEmail, ...memberEmails] = process.argv.slice(2);

async function main() {
  if (!householdName || !ownerEmail) {
    throw new Error(
      "Usage: npx tsx scripts/backfill-household.ts <householdName> <ownerEmail> [memberEmail...]",
    );
  }

  const alreadyMigrated = await prisma.household.findFirst();
  if (alreadyMigrated) {
    console.log(`A household already exists ("${alreadyMigrated.name}") — nothing to backfill.`);
    return;
  }

  const emails = [ownerEmail, ...memberEmails];
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  const missing = emails.filter((email) => !users.some((u) => u.email === email));
  if (missing.length > 0) {
    throw new Error(`No User found for: ${missing.join(", ")} — they need to have signed in at least once.`);
  }
  const userByEmail = new Map(users.map((u) => [u.email, u]));

  const household = await prisma.$transaction(async (tx) => {
    const household = await tx.household.create({
      data: { name: householdName, slug: slugify(`${householdName}-${Date.now()}`) },
    });
    await tx.member.createMany({
      data: emails.map((email, i) => ({
        householdId: household.id,
        userId: userByEmail.get(email)!.id,
        role: i === 0 ? "owner" : "member",
      })),
    });

    // Copy existing global favourite/hidden/suggested state into the new
    // per-household join table. Raw query, not a typed Prisma call: these
    // three Recipe columns are dropped by the require_household_scoping
    // migration that runs right after this script, so the schema checked
    // into this repo (and the client generated from it) has no typed way
    // to read them at all — even though this script's docstring window is
    // the one moment they still exist in the live database.
    const recipeStates = await tx.$queryRaw<
      { id: string; isFavourite: boolean; isHidden: boolean; lastSuggestedAt: Date | null }[]
    >`SELECT id, "isFavourite", "isHidden", "lastSuggestedAt" FROM "Recipe"
      WHERE "isFavourite" = true OR "isHidden" = true OR "lastSuggestedAt" IS NOT NULL`;
    if (recipeStates.length > 0) {
      await tx.householdRecipeState.createMany({
        data: recipeStates.map((r) => ({
          householdId: household.id,
          recipeId: r.id,
          isFavourite: r.isFavourite,
          isHidden: r.isHidden,
          lastSuggestedAt: r.lastSuggestedAt,
        })),
      });
    }

    // Raw query: MealPlan.householdId is still nullable in the schema at
    // this point in the migration sequence (see file header) — the
    // generated client's typed `update` has no way to target that
    // transient null state once the checked-in schema marks it required.
    const attachedPlans = await tx.$executeRaw`UPDATE "MealPlan" SET "householdId" = ${household.id} WHERE "householdId" IS NULL`;

    return { household, recipeStateCount: recipeStates.length, attachedPlans };
  });

  console.log(`Created household "${household.household.name}" (${household.household.id}).`);
  console.log(`Members: ${emails.join(", ")}.`);
  console.log(`Attached ${household.recipeStateCount} recipe state row(s), ${household.attachedPlans} meal plan(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
