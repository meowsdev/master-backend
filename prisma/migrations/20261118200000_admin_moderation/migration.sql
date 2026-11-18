ALTER TYPE "UserStatus" ADD VALUE 'BANNED';

ALTER TABLE "User" ADD COLUMN "isRestricted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "UserModerationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserModerationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserModerationLog_userId_createdAt_idx" ON "UserModerationLog"("userId", "createdAt");
ALTER TABLE "UserModerationLog" ADD CONSTRAINT "UserModerationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserModerationLog" ADD CONSTRAINT "UserModerationLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
