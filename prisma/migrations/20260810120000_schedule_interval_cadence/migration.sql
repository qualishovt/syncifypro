-- Matrixify-style inline scheduling: deferred first run ("Schedule on"),
-- interval cadence ("Repeat every N units") and a run-count limit.
ALTER TABLE "Schedule" ADD COLUMN "startAt" TIMESTAMP(3);
ALTER TABLE "Schedule" ADD COLUMN "intervalCount" INTEGER;
ALTER TABLE "Schedule" ADD COLUMN "intervalUnit" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "remainingRuns" INTEGER;
