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

/** Create a pending import job for a freshly staged upload. */
export async function createImportJob({
  shop, entity, format, filename = null, sourceR2Key, progressTotal = null,
}) {
  // Assign the shared per-shop job number + create in one transaction.
  return db.$transaction(async (tx) => {
    const number = await nextJobNumber(tx, shop);
    return tx.bulkImportJob.create({
      data: {
        shop, entity, format, filename, sourceR2Key, number,
        status: "pending",
        progressCurrent: 0,
        progressTotal,
      },
    });
  });
}

/** Mark a job running (worker picked it up). */
export async function markImportRunning({ id, progressTotal }) {
  const data = { status: "running" };
  if (progressTotal != null) data.progressTotal = progressTotal;
  return db.bulkImportJob.update({ where: { id }, data });
}

/** Bump the progress counter (records written so far). */
export async function updateImportProgress({ id, progressCurrent, progressTotal }) {
  const data = {};
  if (progressCurrent != null) data.progressCurrent = progressCurrent;
  if (progressTotal != null) data.progressTotal = progressTotal;
  if (Object.keys(data).length === 0) return null;
  return db.bulkImportJob.update({ where: { id }, data });
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
