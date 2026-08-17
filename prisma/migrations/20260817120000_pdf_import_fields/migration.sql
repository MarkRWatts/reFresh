-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "isPdfImport" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "sourceUrl" DROP NOT NULL;

