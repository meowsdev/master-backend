-- CreateTable
CREATE TABLE "DueReminder" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "message" TEXT NOT NULL,
    "sentById" TEXT,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DueReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DueReminder_providerId_createdAt_idx" ON "DueReminder"("providerId", "createdAt");

-- AddForeignKey
ALTER TABLE "DueReminder" ADD CONSTRAINT "DueReminder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

