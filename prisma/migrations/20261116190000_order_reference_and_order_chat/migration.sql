-- Order reference code: 6 characters from A-Z and 0-9 (36^6 = 2,176,782,336 possible codes).
ALTER TABLE "Order" ADD COLUMN "referenceCode" VARCHAR(6);
ALTER TABLE "Order" ADD COLUMN "completedAt" TIMESTAMP(3);

DO $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  current_order RECORD;
  candidate TEXT;
BEGIN
  FOR current_order IN SELECT id FROM "Order" WHERE "referenceCode" IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..6 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * 36)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Order" WHERE "referenceCode" = candidate);
    END LOOP;
    UPDATE "Order" SET "referenceCode" = candidate WHERE id = current_order.id;
  END LOOP;
END $$;

-- Warranty window (3 days) counts from completion; best available value for old orders.
UPDATE "Order" SET "completedAt" = "updatedAt" WHERE "orderStatus" = 'COMPLETED';

ALTER TABLE "Order" ALTER COLUMN "referenceCode" SET NOT NULL;
CREATE UNIQUE INDEX "Order_referenceCode_key" ON "Order"("referenceCode");

-- A message belongs to one order's chat tab; NULL means the main service's General Chat.
ALTER TABLE "Message" ADD COLUMN "orderId" TEXT;
CREATE INDEX "Message_orderId_idx" ON "Message"("orderId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shown to customers before the provider's username (company name has priority).
ALTER TABLE "ProviderProfile" ADD COLUMN "companyName" VARCHAR(120);
