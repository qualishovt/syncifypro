/**
 * db/bulkImportJob.server.js
 *
 * DB helpers for tracking background import jobs — the write-side twin of
 * bulkExportJob.server.js. An import job persists the staged upload's R2 key,
 * a determinate progress counter, per-outcome counts, and the R2 key/URL of the
 * results workbook produced when it finishes.
 *
 * Model lives in prisma/schema.prisma (BulkImportJob). After changing it run:
 *   npx prisma migrate dev --name <name> && npx prisma generate
 */

import db from "../db.server.js";
import { nextJobNumber } from "./jobNumber.server.js";

/**
 * Create a pending import job for a freshly staged upload.
 * `plan`/`options` are objects; they're persisted as JSON so "Repeat" can
 * re-run the import with the same per-sheet plan (filters/columns) and mode.
 */
export async function createImportJob({
  shop, entity, format, filename = null, sourceR2Key, progressTotal = null,
  plan = null, options = null, status = "pending", presetName = null,
}) {
  // Assign the shared per-shop job number + create in one transaction.
  return db.$transaction(async (tx) => {
    const number = await nextJobNumber(tx, shop);
    return tx.bulkImportJob.create({
      data: {
        shop, entity, format, filename, sourceR2Key, number,
        presetName: presetName || null,
        status,
        progressCurrent: 0,
        progressTotal,
        plan: plan == null ? null : JSON.stringify(plan),
        options: options == null ? null : JSON.stringify(options),
      },
    });
  });
}

/**
 * The staged file's job row, created at upload in "ready" status so the
 * import preview carries its job number (like the export run does) before
 * anything runs. Import later ARMS this same row instead of creating a new
 * one, so the number the merchant saw is the number the run gets.
 */
export async function createReadyImportJob({ shop, format, filename, sourceR2Key }) {
  return createImportJob({
    shop, entity: "", format, filename, sourceR2Key, status: "ready",
  });
}

/**
 * Turn a "ready" preview row into a queued run: fill in what the analysis
 * decided (entities, plan, options, progress total) and mark it pending.
 * Returns null if the row isn't this shop's ready job (caller then creates
 * a fresh one — e.g. the row was already imported once).
 */
export async function armReadyImportJob({ id, shop, entity, format, filename, progressTotal, plan, options, presetName = null }) {
  const row = await db.bulkImportJob.findUnique({ where: { id } });
  if (!row || row.shop !== shop || row.status !== "ready") return null;
  return db.bulkImportJob.update({
    where: { id },
    data: {
      entity, format, filename,
      status: "pending",
      progressCurrent: 0,
      progressTotal,
      plan: plan == null ? null : JSON.stringify(plan),
      options: options == null ? null : JSON.stringify(options),
      presetName: presetName || null,
      // The run starts NOW — createdAt is "Started" on the info card.
      createdAt: new Date(),
    },
  });
}

/** Mark a job running (worker picked it up). */
export async function markImportRunning({ id, progressTotal }) {
  const data = { status: "running" };
  if (progressTotal != null) data.progressTotal = progressTotal;
  return db.bulkImportJob.update({ where: { id }, data });
}

/**
 * Bump the progress counter (records written so far). Monotonic — progress
 * writes are fired without awaiting, so a stale, lower value must never
 * overwrite a newer, higher one (the bar would jump backwards).
 */
export async function updateImportProgress({ id, progressCurrent, progressTotal }) {
  const data = {};
  if (progressCurrent != null) data.progressCurrent = progressCurrent;
  if (progressTotal != null) data.progressTotal = progressTotal;
  if (Object.keys(data).length === 0) return null;
  const where = progressCurrent != null
    ? { id, OR: [{ progressCurrent: null }, { progressCurrent: { lt: progressCurrent } }] }
    : { id };
  return db.bulkImportJob.updateMany({ where, data });
}

/** Mark a job complete with outcome counts and the results file. */
export async function markImportComplete({
  id, created, updated, deleted, failed, resultR2Key, resultUrl, resultUrlExpiry, progressCurrent,
}) {
  return db.bulkImportJob.update({
    where: { id },
    data: {
      status: "complete",
      created, updated, deleted, failed,
      resultR2Key, resultUrl, resultUrlExpiry,
      ...(progressCurrent != null ? { progressCurrent } : {}),
      completedAt: new Date(),
    },
  });
}

/** Mark a job failed with an error message. */
/** Ask a running import to stop. The worker checks between sheets and bails. */
export async function requestImportCancel(shop, id) {
  const res = await db.bulkImportJob.updateMany({
    where: { id, shop, status: { in: ["pending", "running"] } },
    data: { cancelRequested: true },
  });
  return res.count > 0;
}

/** True when the job's Cancel button was pressed (workers poll this). */
export async function isImportCancelRequested(id) {
  const job = await db.bulkImportJob.findUnique({ where: { id }, select: { cancelRequested: true } });
  return Boolean(job?.cancelRequested);
}

export async function markImportCancelled({ id }) {
  return db.bulkImportJob.update({
    where: { id },
    data: { status: "cancelled", errorMessage: "Cancelled by user", completedAt: new Date() },
  });
}

export async function markImportFailed({ id, errorMessage }) {
  return db.bulkImportJob.update({
    where: { id },
    data: { status: "failed", errorMessage, completedAt: new Date() },
  });
}

/** Fetch a single job (for status polling). */
export async function getImportJob(id) {
  return db.bulkImportJob.findUnique({ where: { id } });
}

/** Recent jobs for a shop, newest first. */
export async function getImportJobsForShop(shop, limit = 20) {
  return db.bulkImportJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Fail import jobs orphaned by a mid-run server restart. Import jobs are
 * processed in-process by the pg-boss worker, so a crash strands them; pg-boss
 * will re-deliver truly-queued work, but anything left running past the cutoff
 * is marked failed on the next boot. Run once at startup.
 *
 * @returns {Promise<number>}
 */
export async function failStaleImportJobs({ olderThanMinutes = 60 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const { count } = await db.bulkImportJob.updateMany({
    where: { status: { in: ["pending", "running"] }, createdAt: { lt: cutoff } },
    data: {
      status: "failed",
      errorMessage: "Import didn't finish (server restarted before it completed).",
      completedAt: new Date(),
    },
  });
  return count;
}
