-- No provider gets orders without an approved KYC: the grace period for providers from before KYC ends now.
-- (Decided by the owner: admins verify active providers with the admin KYC tool.) Only kycGraceUntil is cleared.
UPDATE "ProviderProfile" SET "kycGraceUntil" = NULL WHERE "kycGraceUntil" IS NOT NULL;
