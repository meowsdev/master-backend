-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BKASH', 'NAGAD', 'BANK');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WalletCredit" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "accountNumber" VARCHAR(40) NOT NULL,
    "accountName" VARCHAR(100) NOT NULL,
    "bankName" VARCHAR(100),
    "branchName" VARCHAR(100),
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "transactionRef" VARCHAR(100),
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletCredit_providerId_availableAt_idx" ON "WalletCredit"("providerId", "availableAt");

-- CreateIndex
CREATE INDEX "WalletCredit_orderId_idx" ON "WalletCredit"("orderId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_providerId_idx" ON "WithdrawalRequest"("providerId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "WalletCredit" ADD CONSTRAINT "WalletCredit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletCredit" ADD CONSTRAINT "WalletCredit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

