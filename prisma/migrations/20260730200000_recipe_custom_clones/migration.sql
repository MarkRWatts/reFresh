-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "clonedFromId" TEXT,
ADD COLUMN     "isUserCreated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Recipe_clonedFromId_idx" ON "Recipe"("clonedFromId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
