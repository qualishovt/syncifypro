-- Excel becomes the default export format.
ALTER TABLE "AppSettings" ALTER COLUMN "defaultExportFormat" SET DEFAULT 'excel';

-- Rows that still carry the old default follow along.
UPDATE "AppSettings" SET "defaultExportFormat" = 'excel' WHERE "defaultExportFormat" = 'csv';
