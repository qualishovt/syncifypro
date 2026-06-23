/**
 * export/entities/activity.js
 *
 * "Activity" has no Shopify API source — in Matrixify it's the app's own
 * import/export log. Here we export THIS app's export-job history from the
 * BulkExportJob table (most recent first). Direct-path only; per-shop.
 */

import { getJobsForShop } from "../../db/bulkExportJob.server.js";

const iso = (d) => (d ? new Date(d).toISOString() : "");

function normalizeActivity(job) {
  return {
    activity_id:  job.id,
    entity:       job.entity ?? "",
    format:       job.format ?? "",
    status:       job.status ?? "",
    row_count:    job.rowCount ?? "",
    filename:     job.filename ?? "",
    error:        job.errorMessage ?? "",
    created_at:   iso(job.createdAt),
    completed_at: iso(job.completedAt),
  };
}

export async function extractActivity(admin, { shop } = {}) {
  if (!shop) return [];
  const jobs = await getJobsForShop(shop, 10_000);
  return jobs.map(normalizeActivity);
}
