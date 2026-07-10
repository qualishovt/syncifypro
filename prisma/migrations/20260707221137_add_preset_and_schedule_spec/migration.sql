-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "spec" TEXT;

-- CreateTable
CREATE TABLE "ExportPreset" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "spec" TEXT NOT NULL,
    "state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportPreset_shop_idx" ON "ExportPreset"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ExportPreset_shop_name_key" ON "ExportPreset"("shop", "name");
