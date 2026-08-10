-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "importedFiles" TEXT,
ADD COLUMN     "onlyNewFiles" BOOLEAN NOT NULL DEFAULT true;
