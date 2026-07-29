-- AlterTable
ALTER TABLE "Recipe" DROP COLUMN "instructions",
ADD COLUMN     "steps" JSONB NOT NULL DEFAULT '[]';
