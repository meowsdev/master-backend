-- A global commission on orders from the platform (50% to start), used by every provider without their own rate.
-- Existing providers keep the percent they have now: their rows are not touched. Only providers added from now on
-- start with no rate of their own (NULL) and so follow the global one. Additive: nothing is dropped.
ALTER TABLE "ProviderProfile" ALTER COLUMN "commissionRate" DROP NOT NULL,
ALTER COLUMN "commissionRate" DROP DEFAULT;

ALTER TABLE "PlatformSetting" ADD COLUMN "platformOrderCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 50.0;
