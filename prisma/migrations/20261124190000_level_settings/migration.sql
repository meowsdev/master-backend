-- Admin-controlled level targets, and a lock for a level an admin set by hand.
ALTER TABLE "ProviderProfile" ADD COLUMN "isLevelLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "levelLockReason" VARCHAR(300);

CREATE TABLE "LevelSetting" (
    "level" "ProviderLevel" NOT NULL,
    "successScore" DECIMAL(3,1) NOT NULL,
    "rating" DECIMAL(3,2) NOT NULL,
    "responseRate" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "uniqueClients" INTEGER NOT NULL,
    "earnings" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "LevelSetting_pkey" PRIMARY KEY ("level")
);

-- The starting targets ($400 / $2,000 / $10,000 at about 122 taka per dollar).
INSERT INTO "LevelSetting" ("level", "successScore", "rating", "responseRate", "orders", "uniqueClients", "earnings") VALUES
  ('LEVEL_1', 5, 4.4, 80, 5, 3, 48800),
  ('LEVEL_2', 7, 4.6, 90, 20, 10, 244000),
  ('TOP_RATED', 8, 4.7, 90, 40, 20, 1220000);
