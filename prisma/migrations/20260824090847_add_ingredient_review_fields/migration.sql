-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "packagedUnit" TEXT,
ADD COLUMN     "packagedUnitBase" TEXT,
ADD COLUMN     "packagedUnitQuantity" DOUBLE PRECISION,
ADD COLUMN     "shoppingListNote" TEXT;
