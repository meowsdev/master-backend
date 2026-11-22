-- AlterTable
ALTER TABLE "ServiceRevision" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completionReason" TEXT,
ADD COLUMN     "wasQualityIssue" BOOLEAN;
