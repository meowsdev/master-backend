-- The KYC grace period is only for people who really were providers. An earlier bug could leave a provider row on a
-- customer's account; with Switch Account (customer ⇄ provider) such a row must not let them act as a provider
-- without an approved KYC. Real providers keep their grace; nothing else changes.
UPDATE "ProviderProfile" p
SET "kycGraceUntil" = NULL
FROM "User" u
WHERE u."id" = p."userId" AND u."role" <> 'PROVIDER' AND p."kycGraceUntil" IS NOT NULL;
