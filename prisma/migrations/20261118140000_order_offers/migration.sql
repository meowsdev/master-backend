CREATE TYPE "OfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

CREATE TABLE "OrderOffer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "wave" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderOffer_orderId_providerId_key" ON "OrderOffer"("orderId", "providerId");
CREATE INDEX "OrderOffer_orderId_status_idx" ON "OrderOffer"("orderId", "status");
CREATE INDEX "OrderOffer_providerId_status_idx" ON "OrderOffer"("providerId", "status");
ALTER TABLE "OrderOffer" ADD CONSTRAINT "OrderOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderOffer" ADD CONSTRAINT "OrderOffer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
