CREATE TABLE "OrderAssignmentLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderAssignmentLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderAssignmentLog_orderId_createdAt_idx" ON "OrderAssignmentLog"("orderId", "createdAt");
ALTER TABLE "OrderAssignmentLog" ADD CONSTRAINT "OrderAssignmentLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAssignmentLog" ADD CONSTRAINT "OrderAssignmentLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAssignmentLog" ADD CONSTRAINT "OrderAssignmentLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
