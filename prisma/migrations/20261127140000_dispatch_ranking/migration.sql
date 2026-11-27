-- Admin-weighted provider ranking for new orders. Additive only, and switched OFF: until an admin turns it on,
-- orders are shared out exactly as before (rating, then completed orders).
CREATE TABLE "DispatchSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "responseRate" INTEGER NOT NULL DEFAULT 8,
    "responseSpeed" INTEGER NOT NULL DEFAULT 5,
    "successScore" INTEGER NOT NULL DEFAULT 8,
    "rating" INTEGER NOT NULL DEFAULT 6,
    "behaviour" INTEGER NOT NULL DEFAULT 7,
    "level" INTEGER NOT NULL DEFAULT 4,
    "experience" INTEGER NOT NULL DEFAULT 3,
    "workload" INTEGER NOT NULL DEFAULT 5,
    "newcomer" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "DispatchSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DispatchSetting" ("id") VALUES ('default') ON CONFLICT DO NOTHING;

CREATE TABLE "ProviderDispatchStats" (
    "providerId" TEXT NOT NULL,
    "responseRate" INTEGER,
    "avgResponseSeconds" INTEGER,
    "successScore" DECIMAL(3,1),
    "rating" DECIMAL(3,2),
    "behaviour" INTEGER NOT NULL DEFAULT 100,
    "level" "ProviderLevel" NOT NULL DEFAULT 'LEVEL_0',
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "activeOrders" INTEGER NOT NULL DEFAULT 0,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderDispatchStats_pkey" PRIMARY KEY ("providerId")
);

ALTER TABLE "ProviderDispatchStats" ADD CONSTRAINT "ProviderDispatchStats_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
