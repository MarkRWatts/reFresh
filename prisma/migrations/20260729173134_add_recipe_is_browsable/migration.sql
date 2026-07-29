-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "isBrowsable" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Recipe_isBrowsable_idx" ON "Recipe"("isBrowsable");
