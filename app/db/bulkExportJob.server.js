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
  shop, entity, format, fields = null, spec = null, filename = null, progressTotal = null,
}) {
  // Assign the shared per-shop job number + create in one transaction.
  return db.$transaction(async (tx) => {
    const number = await nextJobNumber(tx, shop);
    return tx.bulkExportJob.create({
      data: {
        shop, entity, format, fields, status: "pending", number,
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
 */
export async function updateJobProgress({ id, progressCurrent, progressTotal }) {
  const data = {};
  if (progressCurrent != null) data.progressCurrent = progressCurrent;
  if (progressTotal != null) data.progressTotal = progressTotal;
  if (Object.keys(data).length === 0) return null;
  return db.bulkExportJob.update({ where: { id }, data });
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