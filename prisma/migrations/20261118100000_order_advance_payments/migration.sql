CREATE TABLE "OrderAdvancePayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMode" NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderAdvancePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderAdvancePayment_orderId_idx" ON "OrderAdvancePayment"("orderId");
ALTER TABLE "OrderAdvancePayment" ADD CONSTRAINT "OrderAdvancePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
