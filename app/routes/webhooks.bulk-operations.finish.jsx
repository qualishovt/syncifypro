/**
 * app/routes/webhooks.bulk-operations.jsx
 *
 * Shopify calls this webhook when a bulk operation completes,
 * fails, or is cancelled.
 *
 * Register this webhook topic in shopify.app.toml:
 *
 *   [[webhooks.subscriptions]]
 *   topics = ["bulk_operations/finish"]
 *   uri    = "/webhooks/bulk-operations"
 *
 * Shopify sends a POST with JSON body:
 * {
 *   id:           "gid://shopify/BulkOperation/123",
 *   status:       "completed" | "failed" | "cancelled",
 *   error_code:   null | "ACCESS_DENIED" | ...,
 *   admin_graphql_api_id: "gid://shopify/BulkOperation/123",
 *   url:          "https://storage.googleapis.com/..." (only when completed)
 * }
 */

import { authenticate } from "../shopify.server.js";
import { findJobByBulkOperationId, markJobFailed } from "../db/bulkExportJob.server.js";
import { processBulkOperation } from "../workers/bulkOperationWorker.js";

export async function action({ request }) {
  // authenticate.webhook verifies the HMAC signature —
  // rejects requests that didn't come from Shopify
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "BULK_OPERATIONS_FINISH") {
    return new Response("Unhandled topic", { status: 200 });
  }

  const bulkOperationId = payload.admin_graphql_api_id;
  const status          = payload.status;       // "completed" | "failed" | "cancelled"
  const jsonlUrl        = payload.url;          // only present when status = "completed"

  // Find the matching job in our DB
  const job = await findJobByBulkOperationId(bulkOperationId);

  if (!job) {
    // Could be a bulk operation from another part of the app — ignore
    return new Response("OK", { status: 200 });
  }

  if (status !== "completed") {
    await markJobFailed({
      id:           job.id,
      errorMessage: `Bulk operation ${status}. Error code: ${payload.error_code ?? "none"}`,
    });
    return new Response("OK", { status: 200 });
  }

  if (!jsonlUrl) {
    await markJobFailed({ id: job.id, errorMessage: "Bulk operation completed but no URL provided" });
    return new Response("OK", { status: 200 });
  }

  // Process the bulk operation asynchronously — don't await it here.
  // Shopify expects a fast 200 response from webhooks (within 5s).
  // The worker runs in the background and updates the DB when done.
  processBulkOperation({
    jobId:    job.id,
    jsonlUrl,
    entity:   job.entity,
    format:   job.format,
    shop,
  }).catch((err) => {
    console.error(`[bulkOperationWorker] job ${job.id} failed:`, err.message);
  });

  return new Response("OK", { status: 200 });
}