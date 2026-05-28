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

/**
 * Create a new pending bulk export job record.
 */
export async function createBulkExportJob({ shop, entity, format }) {
  return db.bulkExportJob.create({
    data: { shop, entity, format, status: "pending" },
  });
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