-- CreateTable
CREATE TABLE "ServiceProblem" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "nameBn" VARCHAR(200),
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "isCountable" BOOLEAN NOT NULL DEFAULT false,
    "maxCount" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceQuestion" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "text" VARCHAR(255) NOT NULL,
    "textBn" VARCHAR(300),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceQuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "labelBn" VARCHAR(150),
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "isCountable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceQuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderBookingDetail" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "problemId" TEXT,
    "problemName" VARCHAR(200) NOT NULL,
    "problemCount" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "districtId" INTEGER NOT NULL,
    "upazilaId" INTEGER NOT NULL,
    "addressDetail" VARCHAR(300) NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "timeSlot" VARCHAR(40) NOT NULL,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priceBreakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBookingDetail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceProblem_serviceId_idx" ON "ServiceProblem"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceQuestion_serviceId_idx" ON "ServiceQuestion"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceQuestionOption_questionId_idx" ON "ServiceQuestionOption"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBookingDetail_orderId_key" ON "OrderBookingDetail"("orderId");

-- AddForeignKey
ALTER TABLE "ServiceProblem" ADD CONSTRAINT "ServiceProblem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceQuestion" ADD CONSTRAINT "ServiceQuestion_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceQuestionOption" ADD CONSTRAINT "ServiceQuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ServiceQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBookingDetail" ADD CONSTRAINT "OrderBookingDetail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

