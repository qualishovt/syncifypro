-- Presets capture the full Advanced-section options.
-- (Schedule already has an options column — export schedules reuse it.)
ALTER TABLE "ExportPreset" ADD COLUMN "options" TEXT;
