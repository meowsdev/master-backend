-- Per-provider commission: each provider has their own percent, and each order keeps the percent it was made with.
-- Existing rows get 10, the platform-wide rate used until now.

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 10.0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 10.0;
