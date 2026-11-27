-- Job costs now pass technician → provider → admin, and either reviewer can send them back with changed amounts.
-- Additive only: new statuses and columns; existing claims keep their status and behave as before.
ALTER TYPE "ExpenseClaimStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_REVIEW';
ALTER TYPE "ExpenseClaimStatus" ADD VALUE IF NOT EXISTS 'RETURNED_TO_TECHNICIAN';

ALTER TABLE "OrderExpenseClaim" ADD COLUMN "isFromTechnician" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "providerNote" VARCHAR(300);
