CREATE TABLE "SupportThread" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lastStaffReadAt" TIMESTAMP(3),
    "lastMemberReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportThread_memberId_key" ON "SupportThread"("memberId");
CREATE INDEX "SupportMessage_threadId_createdAt_idx" ON "SupportMessage"("threadId", "createdAt");
CREATE INDEX "SupportMessage_senderId_idx" ON "SupportMessage"("senderId");
ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
