/*
  Warnings:

  - You are about to drop the column `splitRows` on the `ExportPreset` table. All the data in the column will be lost.
  - You are about to drop the column `splitRows` on the `Schedule` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ExportPreset" DROP COLUMN "splitRows";

-- AlterTable
ALTER TABLE "Schedule" DROP COLUMN "splitRows",
ADD COLUMN     "presetId" TEXT;
