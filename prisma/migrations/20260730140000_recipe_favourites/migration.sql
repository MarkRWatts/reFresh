-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "isFavourite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Recipe_isFavourite_idx" ON "Recipe"("isFavourite");
