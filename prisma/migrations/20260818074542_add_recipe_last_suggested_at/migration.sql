-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "lastSuggestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Recipe_lastSuggestedAt_idx" ON "Recipe"("lastSuggestedAt");
