-- Sliding-session support: group rotations into families and track chaining.
ALTER TABLE "RefreshToken"
  ADD COLUMN "familyId" TEXT,
  ADD COLUMN "replacedByTokenId" TEXT,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing tokens each become their own single-token family.
UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;

ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
