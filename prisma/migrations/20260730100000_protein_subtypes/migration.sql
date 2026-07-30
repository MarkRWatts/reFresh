-- AlterEnum
-- Splits ProteinType.MEAT into CHICKEN/TURKEY/BEEF/LAMB/PORK/MEAT_OTHER.
-- Existing 'MEAT' rows are temporarily mapped to 'MEAT_OTHER' (any valid
-- value works here) — `npm run reprocess` immediately afterward reclassifies
-- every recipe from its actual ingredients, so this mapping is never the
-- final answer for any row, just a placeholder the type-swap requires.
BEGIN;
CREATE TYPE "ProteinType_new" AS ENUM ('CHICKEN', 'TURKEY', 'BEEF', 'LAMB', 'PORK', 'MEAT_OTHER', 'FISH', 'VEGETARIAN', 'VEGAN', 'UNKNOWN');
ALTER TABLE "public"."Recipe" ALTER COLUMN "proteinType" DROP DEFAULT;
ALTER TABLE "Recipe" ALTER COLUMN "proteinType" TYPE "ProteinType_new" USING (
  CASE "proteinType"::text
    WHEN 'MEAT' THEN 'MEAT_OTHER'
    ELSE "proteinType"::text
  END::"ProteinType_new"
);
ALTER TYPE "ProteinType" RENAME TO "ProteinType_old";
ALTER TYPE "ProteinType_new" RENAME TO "ProteinType";
DROP TYPE "public"."ProteinType_old";
ALTER TABLE "Recipe" ALTER COLUMN "proteinType" SET DEFAULT 'UNKNOWN';
COMMIT;
