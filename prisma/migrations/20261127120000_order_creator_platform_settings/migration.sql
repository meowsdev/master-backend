-- Who created each order (a tag on every screen), and the admin's rule for charging provider-created orders.
-- Additive only: existing orders become CUSTOMER with no creator id; nothing is dropped or rewritten.
CREATE TYPE "OrderCreator" AS ENUM ('CUSTOMER', 'PROVIDER', 'ADMIN');

ALTER TABLE "Order" ADD COLUMN "createdByRole" "OrderCreator" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN "createdById" TEXT;

CREATE INDEX "Order_createdById_idx" ON "Order"("createdById");

-- Deleting an account keeps its orders; only the tag loses the name.
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "providerOrderChargeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "providerOrderChargeRate" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSetting" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
