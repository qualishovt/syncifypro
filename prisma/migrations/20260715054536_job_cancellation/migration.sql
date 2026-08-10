-- AlterTable
ALTER TABLE "BulkExportJob" ADD COLUMN     "cancelRequested" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BulkImportJob" ADD COLUMN     "cancelRequested" BOOLEAN NOT NULL DEFAULT false;
