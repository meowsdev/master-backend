-- What the provider / technician spent on a finished job; an admin reviews it and the commission is worked out on (total - costs).
CREATE TYPE "ExpenseClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "OrderExpenseClaim" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "claimedTotal" DECIMAL(10,2) NOT NULL,
    "approvedItems" JSONB,
    "approvedTotal" DECIMAL(10,2),
    "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(300),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "commissionBefore" DECIMAL(10,2),
    "commissionAfter" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderExpenseClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderExpenseClaim_orderId_idx" ON "OrderExpenseClaim"("orderId");
CREATE INDEX "OrderExpenseClaim_status_idx" ON "OrderExpenseClaim"("status");

ALTER TABLE "OrderExpenseClaim" ADD CONSTRAINT "OrderExpenseClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderExpenseClaim" ADD CONSTRAINT "OrderExpenseClaim_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderExpenseClaim" ADD CONSTRAINT "OrderExpenseClaim_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
