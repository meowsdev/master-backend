CREATE TYPE "ExtraChargeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ExtraChargeRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "previousTotal" DECIMAL(10,2) NOT NULL,
    "status" "ExtraChargeStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtraChargeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExtraChargeRequest_orderId_idx" ON "ExtraChargeRequest"("orderId");
ALTER TABLE "ExtraChargeRequest" ADD CONSTRAINT "ExtraChargeRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtraChargeRequest" ADD CONSTRAINT "ExtraChargeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
