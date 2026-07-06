-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkExportJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "bulkOperationId" TEXT,
    "fields" TEXT,
    "spec" TEXT,
    "filename" TEXT,
    "r2Key" TEXT,
    "signedUrl" TEXT,
    "signedUrlExpiry" TIMESTAMP(3),
    "rowCount" INTEGER,
    "progressCurrent" INTEGER,
    "progressTotal" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BulkExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkExportJob_shop_idx" ON "BulkExportJob"("shop");

-- CreateIndex
CREATE INDEX "BulkExportJob_bulkOperationId_idx" ON "BulkExportJob"("bulkOperationId");
