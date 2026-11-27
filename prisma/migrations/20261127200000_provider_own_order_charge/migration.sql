-- A provider's own charge on the orders they create themselves. Null (every provider now) keeps the global rule,
-- so nothing changes until an admin sets one. Additive only.
ALTER TABLE "ProviderProfile" ADD COLUMN "ownOrderChargeRate" DECIMAL(5,2);
