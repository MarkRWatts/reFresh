-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Recipe_isHidden_idx" ON "Recipe"("isHidden");
