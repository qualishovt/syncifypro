/**
 * db/bulkExportJob.server.js
 *
 * DB helpers for tracking bulk export jobs.
 * Uses Prisma — add this model to your schema.prisma:
 *
 * model BulkExportJob {
 *   id              String   @id @default(cuid())
 *   shop            String
 *   entity          String
 *   format          String
 *   status          String   @default("pending")
 *   // pending | running | complete | failed
 *   bulkOperationId String?  // Shopify bulk operation GID
 *   fields          String?  // comma-separated column selection (null = all)
 *   r2Key           String?
 *   signedUrl       String?
 *   signedUrlExpiry DateTime?
 *   rowCount        Int?
 *   errorMessage    String?
 *   createdAt       DateTime @default(now())
 *   completedAt     DateTime?
 *
 *   @@index([shop])
 *   @@index([bulkOperationId])
 * }
 *
 * Then run: npx prisma migrate dev --name add_bulk_export_job
 */

import db from "../db.server.js";
import { nextJobNumber } from "./jobNumber.server.js";

/**
 * Create a new pending bulk export job record.
 * `spec` is a JSON array of `{ entity, filters, fields }` (multi-entity);
 * `entity` is a comma-list of the entity slugs for display.
 */
export async function createBulkExportJob({
  id = undefined, shop, entity, format, fields = null, spec = null, filename = null, progressTotal = null,
  presetName = null,
}) {
  // Assign the shared per-shop job number + create in one transaction.
  // `id` may be supplied by the caller (the job page navigates optimistically
  // with a client-generated id before the row exists).
  return db.$transaction(async (tx) => {
    const number = await nextJobNumber(tx, shop);
    return tx.bulkExportJob.create({
      data: {
        id, shop, entity, format, fields, status: "pending", number,
        presetName: presetName || null,
        spec:     spec ? JSON.stringify(spec) : null,
        filename: filename ?? null,
        progressCurrent: 0,
        progressTotal,
      },
    });
  });
}

/**
 * Update a running job's progress counter (records processed so far, and
 * optionally the expected total). Backs the determinate progress bar.
 *
 * Progress writes are fired from hot fetch loops without awaiting, so
 * commits can land out of order. The `lt` guard makes the counter
 * monotonic — a stale, lower value never overwrites a newer, higher one
 * (which showed up as the bar jumping backwards near completion).
 */
export async function updateJobProgress({ id, progressCurrent, progressTotal }) {
  const data = {};
  if (progressCurrent != null) data.progressCurrent = progressCurrent;
  if (progressTotal != null) data.progressTotal = progressTotal;
  if (Object.keys(data).length === 0) return null;
  const where = progressCurrent != null
    ? { id, OR: [{ progressCurrent: null }, { progressCurrent: { lt: progressCurrent } }] }
    : { id };
  return db.bulkExportJob.updateMany({ where, data });
}

/**
 * Mark a job as running and store the Shopify bulk operation ID.
 */
export async function markJobRunning({ id, bulkOperationId }) {
  return db.bulkExportJob.update({
    where: { id },
    data:  { status: "running", bulkOperationId },
  });
}

/**
 * Mark a job as complete with its R2 key and signed URL.
 */
export async function markJobComplete({ id, r2Key, signedUrl, signedUrlExpiry, rowCount }) {
  return db.bulkExportJob.update({
    where: { id },
    data: {
      status: "complete",
      r2Key,
      signedUrl,
      signedUrlExpiry,
      rowCount,
      completedAt: new Date(),
    },
  });
}

/**
 * Mark a job as failed with an error message.
 */
/** Ask a running job to stop. The worker checks between entities and bails. */
export async function requestJobCancel(shop, id) {
  const res = await db.bulkExportJob.updateMany({
    where: { id, shop, status: { in: ["pending", "running"] } },
    data: { cancelRequested: true },
  });
  return res.count > 0;
}

/** True when the job's Cancel button was pressed (workers poll this). */
export async function isJobCancelRequested(id) {
  const job = await db.bulkExportJob.findUnique({ where: { id }, select: { cancelRequested: true } });
  return Boolean(job?.cancelRequested);
}

export async function markJobCancelled({ id }) {
  return db.bulkExportJob.update({
    where: { id },
    data: { status: "cancelled", errorMessage: "Cancelled by user", completedAt: new Date() },
  });
}

export async function markJobFailed({ id, errorMessage }) {
  return db.bulkExportJob.update({
    where: { id },
    data: { status: "failed", errorMessage, completedAt: new Date() },
  });
}

/**
 * Find a job by its Shopify bulk operation ID.
 * Used in the webhook handler to match the incoming event.
 */
export async function findJobByBulkOperationId(bulkOperationId) {
  return db.bulkExportJob.findFirst({
    where: { bulkOperationId },
  });
}

/**
 * Get all jobs for a shop, most recent first.
 */
export async function getJobsForShop(shop, limit = 20) {
  return db.bulkExportJob.findMany({
    where:   { shop },
    orderBy: { createdAt: "desc" },
    take:    limit,
  });
}

/**
 * Get a single job by ID.
 */
export async function getJob(id) {
  return db.bulkExportJob.findUnique({ where: { id } });
}

/**
 * Parse a job's stored `spec` column. Two shapes exist:
 *   - legacy: a bare array of per-entity specs
 *   - v2: { v: 2, specs: [...], options: {...} } — the envelope also carries
 *     the run's advanced options so the result page can display them.
 * Always returns { specs, options }.
 */
export function parseJobSpec(raw) {
  if (!raw) return { specs: null, options: {} };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { specs: parsed, options: {} };
    return {
      specs: parsed.specs ?? null,
      options: parsed.options ?? {},
    };
  } catch {
    return { specs: null, options: {} };
  }
}

/**
 * The most recent export whose configuration was stored — powers the
 * "Latest Export" preset across page loads (the in-memory copy only
 * survives one browser session).
 */
export async function latestExportSpec(shop) {
  const job = await db.bulkExportJob.findFirst({
    where:   { shop, spec: { not: null } },
    orderBy: { createdAt: "desc" },
    select:  { format: true, spec: true },
  });
  if (!job) return null;
  const { specs } = parseJobSpec(job.spec);
  return specs ? { format: job.format, spec: specs } : null;
}

/**
 * Most recent successful export time per entity — backs the sheet table's
 * "Last export" column. A job's `entity` is a comma-list of slugs, so one
 * multi-entity job stamps every slug it covered.
 */
export async function lastExportPerEntity(shop, limit = 300) {
  const jobs = await db.bulkExportJob.findMany({
    where:   { shop, status: "complete" },
    orderBy: { completedAt: "desc" },
    take:    limit,
    select:  { entity: true, completedAt: true },
  });
  const map = {};
  for (const job of jobs) {
    if (!job.completedAt) continue;
    for (const slug of String(job.entity || "").split(",")) {
      const key = slug.trim();
      if (key && !(key in map)) map[key] = job.completedAt.toISOString();
    }
  }
  return map;
}

/**
 * Total number of export jobs for a shop — backs the "activity" entity count
 * (an app-owned entity with no Shopify Admin count query).
 */
export async function countJobsForShop(shop) {
  return db.bulkExportJob.count({ where: { shop } });
}

/**
 * Fail orphaned in-process jobs — ones left pending/running past the cutoff
 * because the server restarted mid-export (the in-process failure mode). Only
 * targets jobs WITHOUT a bulkOperationId; Shopify bulk-operation jobs
 * (bulkOperationId set) legitimately run long and are finished by their
 * webhook, so they're left alone. Run once at server startup.
 *
 * @returns {Promise<number>} how many jobs were marked failed
 */
export async function failStaleJobs({ olderThanMinutes = 30 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const { count } = await db.bulkExportJob.updateMany({
    where: {
      status: { in: ["pending", "running"] },
      bulkOperationId: null,
      createdAt: { lt: cutoff },
    },
    data: {
      status: "failed",
      errorMessage: "Export didn't finish (server restarted before it completed).",
      completedAt: new Date(),
    },
  });
  return count;
}