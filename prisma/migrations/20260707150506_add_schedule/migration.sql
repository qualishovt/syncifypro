-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL,
    "hour" INTEGER NOT NULL DEFAULT 3,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "weekday" INTEGER,
    "monthday" INTEGER,
    "entity" TEXT,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "sourceR2Key" TEXT,
    "filename" TEXT,
    "plan" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Schedule_shop_idx" ON "Schedule"("shop");

-- CreateIndex
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled", "nextRunAt");
