-- Catch-up migration. These columns/tables were added to schema.prisma and applied to the local
-- database with `db push`, so no migration ever created them: a database built only from
-- migrations (the server) lacked User.username, the service catalog columns, OrderItem and
-- ChatSession.categoryId. Every statement is idempotent, so it is also safe on a database that
-- already has them (the local one).

-- PriceUnit enum
DO $$ BEGIN
  CREATE TYPE "PriceUnit" AS ENUM ('FIXED', 'PER_SQFT', 'PER_UNIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- User.username
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(30);
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- ServiceCategory
ALTER TABLE "ServiceCategory"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "icon" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "isPopular" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shortDescription" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "ServiceCategory_sortOrder_idx" ON "ServiceCategory"("sortOrder");

-- Service: slug is NOT NULL, so existing rows get one derived from the name (+ id prefix to stay unique).
ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "imageUrl" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isPopular" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nameBn" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "orderCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "priceUnit" "PriceUnit" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "slug" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
UPDATE "Service"
SET "slug" = left(
  coalesce(nullif(trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'service')
  || '-' || substr("id", 1, 6), 120)
WHERE "slug" IS NULL;
ALTER TABLE "Service" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Service_categoryId_slug_key" ON "Service"("categoryId", "slug");
CREATE INDEX IF NOT EXISTS "Service_isPopular_idx" ON "Service"("isPopular");

-- OrderItem
CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subServiceId" TEXT NOT NULL,
    "nameSnapshot" VARCHAR(100) NOT NULL,
    "unitPriceSnapshot" DECIMAL(10,2) NOT NULL,
    "priceUnitSnapshot" "PriceUnit" NOT NULL DEFAULT 'FIXED',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lineTotal" DECIMAL(10,2) NOT NULL,
    "durationSnapshot" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_subServiceId_idx" ON "OrderItem"("subServiceId");
DO $$ BEGIN
  ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_subServiceId_fkey" FOREIGN KEY ("subServiceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ChatSession: one chat per customer per main service (category). Fill what can be derived from
-- existing rows; a session that still lacks a customer profile or service cannot satisfy the new
-- rules, and of several sessions for the same customer + category only the oldest is kept.
ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
UPDATE "ChatSession" cs SET "customerProfileId" = cp."id"
  FROM "CustomerProfile" cp WHERE cs."customerProfileId" IS NULL AND cp."userId" = cs."customerId";
UPDATE "ChatSession" cs SET "categoryId" = s."categoryId"
  FROM "Service" s WHERE cs."categoryId" IS NULL AND s."id" = cs."serviceId";
DELETE FROM "ChatSession" WHERE "customerProfileId" IS NULL OR "serviceId" IS NULL OR "categoryId" IS NULL;
DELETE FROM "ChatSession" cs USING "ChatSession" older
  WHERE cs."customerProfileId" = older."customerProfileId" AND cs."categoryId" = older."categoryId"
    AND (older."createdAt", older."id") < (cs."createdAt", cs."id");
ALTER TABLE "ChatSession" ALTER COLUMN "customerProfileId" SET NOT NULL;
ALTER TABLE "ChatSession" ALTER COLUMN "serviceId" SET NOT NULL;
ALTER TABLE "ChatSession" ALTER COLUMN "categoryId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "ChatSession_categoryId_idx" ON "ChatSession"("categoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatSession_customerProfileId_categoryId_key" ON "ChatSession"("customerProfileId", "categoryId");
ALTER TABLE "ChatSession" DROP CONSTRAINT IF EXISTS "ChatSession_customerProfileId_fkey";
ALTER TABLE "ChatSession" DROP CONSTRAINT IF EXISTS "ChatSession_serviceId_fkey";
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DO $$ BEGIN
  ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
