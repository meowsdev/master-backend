-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REPLACED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "isPricePending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantNameSnapshot" VARCHAR(100);

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "details" TEXT,
ADD COLUMN     "excluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "included" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServiceCategory" ADD COLUMN     "details" TEXT,
ADD COLUMN     "excluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "howToOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "imageUrl" VARCHAR(500),
ADD COLUMN     "included" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ServiceGroup" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "nameBn" VARCHAR(150),
    "slug" VARCHAR(120) NOT NULL,
    "iconUrl" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVariant" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "nameBn" VARCHAR(150),
    "imageUrl" VARCHAR(500),
    "price" DECIMAL(10,2) NOT NULL,
    "originalPrice" DECIMAL(10,2),
    "priceUnit" "PriceUnit" NOT NULL DEFAULT 'FIXED',
    "durationMin" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFaq" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "serviceId" TEXT,
    "question" VARCHAR(300) NOT NULL,
    "questionBn" VARCHAR(400),
    "answer" TEXT NOT NULL,
    "answerBn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderQuote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "note" VARCHAR(500),
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceGroup_name_key" ON "ServiceGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceGroup_slug_key" ON "ServiceGroup"("slug");

-- CreateIndex
CREATE INDEX "ServiceGroup_sortOrder_idx" ON "ServiceGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "ServiceVariant_serviceId_idx" ON "ServiceVariant"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceFaq_categoryId_idx" ON "ServiceFaq"("categoryId");

-- CreateIndex
CREATE INDEX "ServiceFaq_serviceId_idx" ON "ServiceFaq"("serviceId");

-- CreateIndex
CREATE INDEX "OrderQuote_orderId_status_idx" ON "OrderQuote"("orderId", "status");

-- CreateIndex
CREATE INDEX "Order_categoryId_idx" ON "Order"("categoryId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "ServiceCategory_groupId_idx" ON "ServiceCategory"("groupId");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ServiceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVariant" ADD CONSTRAINT "ServiceVariant_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFaq" ADD CONSTRAINT "ServiceFaq_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFaq" ADD CONSTRAINT "ServiceFaq_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderQuote" ADD CONSTRAINT "OrderQuote_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ServiceVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (keeps all existing data) -------------------------------------------------------------

-- Every existing main service goes under one starter category until an admin moves it.
INSERT INTO "ServiceGroup" ("id", "name", "nameBn", "slug", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, 'Other Services', 'অন্যান্য সার্ভিস', 'other-services', 999, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "ServiceCategory" WHERE "groupId" IS NULL);

UPDATE "ServiceCategory"
SET "groupId" = (SELECT "id" FROM "ServiceGroup" WHERE "slug" = 'other-services')
WHERE "groupId" IS NULL;

-- Every existing sub-service keeps its price as one "Standard" variant, so it can be added to the cart.
INSERT INTO "ServiceVariant" ("id", "serviceId", "name", "nameBn", "price", "priceUnit", "durationMin", "updatedAt")
SELECT gen_random_uuid()::text, s."id", 'Standard', 'স্ট্যান্ডার্ড', s."basePrice", s."priceUnit", s."durationMin", CURRENT_TIMESTAMP
FROM "Service" s
WHERE s."slug" <> 'admin-custom-order'
  AND NOT EXISTS (SELECT 1 FROM "ServiceVariant" v WHERE v."serviceId" = s."id");

-- Orders learn their main service (the chat they are a tab of).
UPDATE "Order" o SET "categoryId" = s."categoryId" FROM "Service" s WHERE o."serviceId" = s."id" AND o."categoryId" IS NULL;
