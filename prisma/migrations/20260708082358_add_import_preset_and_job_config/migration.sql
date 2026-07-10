-- AlterTable
ALTER TABLE "BulkImportJob" ADD COLUMN     "options" TEXT,
ADD COLUMN     "plan" TEXT;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "options" TEXT;

-- CreateTable
CREATE TABLE "ImportPreset" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "plan" TEXT NOT NULL,
    "options" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportPreset_shop_idx" ON "ImportPreset"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ImportPreset_shop_name_key" ON "ImportPreset"("shop", "name");
