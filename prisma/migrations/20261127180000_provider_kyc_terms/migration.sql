-- Record when a provider accepted the provider terms (conduct and liability) and which version. Additive only.
ALTER TABLE "ProviderKyc" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" VARCHAR(40);
