-- CreateTable
CREATE TABLE "BulkExportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bulkOperationId" TEXT,
    "r2Key" TEXT,
    "signedUrl" TEXT,
    "signedUrlExpiry" DATETIME,
    "rowCount" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "BulkExportJob_shop_idx" ON "BulkExportJob"("shop");

-- CreateIndex
CREATE INDEX "BulkExportJob_bulkOperationId_idx" ON "BulkExportJob"("bulkOperationId");
