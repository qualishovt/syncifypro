-- CreateTable
CREATE TABLE "BulkImportJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filename" TEXT,
    "sourceR2Key" TEXT,
    "progressCurrent" INTEGER,
    "progressTotal" INTEGER,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "resultR2Key" TEXT,
    "resultUrl" TEXT,
    "resultUrlExpiry" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BulkImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkImportJob_shop_idx" ON "BulkImportJob"("shop");
