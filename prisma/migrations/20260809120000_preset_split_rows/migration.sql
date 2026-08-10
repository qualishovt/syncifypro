-- Presets remember the file-split setting too.
ALTER TABLE "ExportPreset" ADD COLUMN "splitRows" INTEGER;
