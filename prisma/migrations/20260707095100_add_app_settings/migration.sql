-- CreateTable
CREATE TABLE "AppSettings" (
    "shop" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("shop")
);
