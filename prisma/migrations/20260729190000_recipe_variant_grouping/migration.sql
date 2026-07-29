-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "variantOfId" TEXT;

-- CreateIndex
CREATE INDEX "Recipe_variantOfId_idx" ON "Recipe"("variantOfId");

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_variantOfId_fkey" FOREIGN KEY ("variantOfId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
