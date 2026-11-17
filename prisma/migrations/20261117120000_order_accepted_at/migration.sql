ALTER TABLE "Order" ADD COLUMN "acceptedAt" TIMESTAMP(3);
-- Orders already past PENDING: best available value.
UPDATE "Order" SET "acceptedAt" = "updatedAt" WHERE "orderStatus" <> 'PENDING' AND "orderStatus" <> 'CANCELLED';
