-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "defaultExportFormat" TEXT NOT NULL DEFAULT 'csv',
ADD COLUMN     "defaultImportMode" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "notifyEmail" TEXT,
ADD COLUMN     "notifyOnError" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyOnSuccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';
