ALTER TABLE "CustomerProfile" ADD COLUMN "rating" DECIMAL(3,2) NOT NULL DEFAULT 0.0;

CREATE TABLE "CustomerRating" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ratedById" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerRating_orderId_key" ON "CustomerRating"("orderId");
CREATE INDEX "CustomerRating_customerId_idx" ON "CustomerRating"("customerId");
ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
