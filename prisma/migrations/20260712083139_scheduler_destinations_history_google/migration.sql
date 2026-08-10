-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "destinations" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "ScheduleRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "scheduleName" TEXT NOT NULL DEFAULT '',
    "task" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "delivery" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "expiryDate" TIMESTAMP(3),
    "scope" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE INDEX "ScheduleRun_shop_idx" ON "ScheduleRun"("shop");

-- CreateIndex
CREATE INDEX "ScheduleRun_scheduleId_idx" ON "ScheduleRun"("scheduleId");
