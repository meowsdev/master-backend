-- An unanswered extra-bill request is approved automatically when the customer does not use the app.
ALTER TABLE "ExtraChargeRequest" ADD COLUMN "autoApproveAt" TIMESTAMP(3),
ADD COLUMN "isAutoApproved" BOOLEAN NOT NULL DEFAULT false;

-- The scheduler looks for pending requests whose time has come.
CREATE INDEX "ExtraChargeRequest_status_autoApproveAt_idx" ON "ExtraChargeRequest"("status", "autoApproveAt");
