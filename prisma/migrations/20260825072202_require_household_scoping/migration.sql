-- AlterTable
ALTER TABLE "MealPlan" ALTER COLUMN "householdId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Recipe" DROP COLUMN "isFavourite",
DROP COLUMN "isHidden",
DROP COLUMN "lastSuggestedAt";

