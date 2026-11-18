-- User.districtId / upazilaId existed in schema.prisma but in no migration (they were created with
-- `db push` locally), so a database built only from migrations lacks them. IF NOT EXISTS keeps
-- this safe for databases that already have the columns.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "districtId" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "upazilaId" INTEGER;

CREATE TABLE "ProviderServiceArea" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "districtId" INTEGER NOT NULL,
    "upazilaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderServiceArea_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderServiceArea_providerId_upazilaId_key" ON "ProviderServiceArea"("providerId", "upazilaId");
CREATE INDEX "ProviderServiceArea_upazilaId_idx" ON "ProviderServiceArea"("upazilaId");
CREATE INDEX "ProviderServiceArea_districtId_idx" ON "ProviderServiceArea"("districtId");
ALTER TABLE "ProviderServiceArea" ADD CONSTRAINT "ProviderServiceArea_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Providers who already told us where they live keep receiving orders from there.
INSERT INTO "ProviderServiceArea" ("id", "providerId", "districtId", "upazilaId")
SELECT gen_random_uuid()::text, pp."id", u."districtId", u."upazilaId"
FROM "ProviderProfile" pp
JOIN "User" u ON u."id" = pp."userId"
WHERE u."districtId" IS NOT NULL AND u."upazilaId" IS NOT NULL;
