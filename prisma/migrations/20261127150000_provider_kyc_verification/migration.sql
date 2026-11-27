-- Provider KYC: the full verification form, and a grace period for providers who were already working.
-- Additive only. Every existing provider without an approved KYC gets 14 days to send theirs; until then they keep
-- getting orders exactly as before. New providers (null grace) get orders only once their KYC is approved.
ALTER TABLE "ProviderProfile" ADD COLUMN "kycGraceUntil" TIMESTAMP(3);

UPDATE "ProviderProfile" p
SET "kycGraceUntil" = NOW() + INTERVAL '14 days'
WHERE NOT EXISTS (SELECT 1 FROM "ProviderKyc" k WHERE k."providerId" = p."id" AND k."status" = 'APPROVED');

ALTER TABLE "ProviderKyc" ADD COLUMN "fullName" VARCHAR(100),
ADD COLUMN "districtId" INTEGER,
ADD COLUMN "upazilaId" INTEGER,
ADD COLUMN "addressDetail" VARCHAR(300),
ADD COLUMN "selfieUrl" VARCHAR(255),
ADD COLUMN "emergencyContacts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "rejectReason" VARCHAR(300);
