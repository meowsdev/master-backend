-- The order catalog now follows the real hierarchy: ServiceCategory (main service)
-- -> Service (sub-service, "problem"). Quantities come from Service.priceUnit and are
-- stored as OrderItem, so the separate ServiceProblem table is gone and follow-up
-- questions belong to the main service.
DROP TABLE "ServiceProblem";

-- Only starter seed rows existed; they are re-seeded against categories.
DELETE FROM "ServiceQuestion";
ALTER TABLE "ServiceQuestion" DROP CONSTRAINT "ServiceQuestion_serviceId_fkey";
DROP INDEX "ServiceQuestion_serviceId_idx";
ALTER TABLE "ServiceQuestion" DROP COLUMN "serviceId";
ALTER TABLE "ServiceQuestion" ADD COLUMN "categoryId" TEXT NOT NULL;
CREATE INDEX "ServiceQuestion_categoryId_idx" ON "ServiceQuestion"("categoryId");
ALTER TABLE "ServiceQuestion" ADD CONSTRAINT "ServiceQuestion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderBookingDetail" RENAME COLUMN "problemId" TO "subServiceId";
ALTER TABLE "OrderBookingDetail" RENAME COLUMN "problemName" TO "subServiceName";
ALTER TABLE "OrderBookingDetail" RENAME COLUMN "problemCount" TO "quantity";
