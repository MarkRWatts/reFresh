-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT true;
