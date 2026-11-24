-- Provider levels become Level 0 / Level 1 / Level 2 / Top Rated (six metrics, see level-rules.ts).
-- Old levels are carried over the nearest way; the next monthly evaluation works every provider out again.
CREATE TYPE "ProviderLevel_new" AS ENUM ('LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'TOP_RATED');

ALTER TABLE "ProviderProfile" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "ProviderProfile" ALTER COLUMN "level" TYPE "ProviderLevel_new" USING (
  CASE "level"::text
    WHEN 'BRONZE' THEN 'LEVEL_1'
    WHEN 'SILVER' THEN 'LEVEL_2'
    WHEN 'GOLD' THEN 'TOP_RATED'
    WHEN 'PLATINUM' THEN 'TOP_RATED'
    ELSE 'LEVEL_0'
  END
)::"ProviderLevel_new";

DROP TYPE "ProviderLevel";
ALTER TYPE "ProviderLevel_new" RENAME TO "ProviderLevel";
ALTER TABLE "ProviderProfile" ALTER COLUMN "level" SET DEFAULT 'LEVEL_0';
