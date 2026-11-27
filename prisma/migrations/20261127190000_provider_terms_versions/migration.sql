-- Admin-editable provider terms: each publish is a new version, and every acceptance is kept as proof.
-- Additive only. With no version row yet, the built-in text counts as version 1.
CREATE TABLE "ProviderTermsVersion" (
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ProviderTermsVersion_pkey" PRIMARY KEY ("version")
);

CREATE TABLE "ProviderTermsAcceptance" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderTermsAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderTermsAcceptance_providerId_version_idx" ON "ProviderTermsAcceptance"("providerId", "version");

ALTER TABLE "ProviderTermsAcceptance" ADD CONSTRAINT "ProviderTermsAcceptance_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
