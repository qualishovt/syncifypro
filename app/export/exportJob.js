/**
 * export/exportJob.js
 *
 * Orchestrator: auto-switches between direct export (small stores)
 * and bulk operation export (large stores, 10k+ products).
 *
 * Direct:  fetch → format → upload to R2 → return signed URL immediately
 * Bulk:    submit bulk op → return jobId → webhook → worker → R2
 */

import { extractProducts }             from "./entities/products.js";
import { extractOrders }               from "./entities/orders.js";
import { submitProductsBulkOperation,
         getProductCount }             from "./entities/productsBulk.js";
import { toCSV }                       from "./formats/csv.js";
import { uploadToR2 }                  from "./delivery/r2.js";
import { createBulkExportJob,
         markJobRunning }              from "../db/bulkExportJob.server.js";
// import { toExcel } from "./formats/excel.js";
// import { toXML }   from "./formats/xml.js";
// import { toJSON }  from "./formats/json.js";

/** Threshold above which we switch to bulk operations */
const BULK_THRESHOLD = 10_000;

const FORMAT_ADAPTERS = {
  csv: toCSV,
  // excel: toExcel,
  // xml:   toXML,
  // json:  toJSON,
};

const ENTITY_EXTRACTORS = {
  products: extractProducts,
  orders:   extractOrders,
  // collections: extractCollections,
  // discounts:   extractDiscounts,
  // customers:   extractCustomers,
};

/** Entities that support bulk operations */
const BULK_SUPPORTED = ["products"];

const MIME_TYPES = {
  csv:   "text/csv",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml:   "application/xml",
  json:  "application/json",
};

/**
 * Run an export job — auto-selects direct or bulk based on store size.
 *
 * Returns one of two shapes:
 *
 * Direct (small store):
 *   { mode: "direct", signedUrl, filename, expiresAt, r2Key }
 *
 * Bulk (large store):
 *   { mode: "bulk", jobId }
 *   → UI should poll /app/jobs/:jobId until status = "complete"
 *
 * @param {object} options
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} options.admin
 * @param {string} options.shop
 * @param {string} options.entity
 * @param {string} options.format
 */
export async function runExportJob({ admin, shop, entity, format }) {
  const adapter = FORMAT_ADAPTERS[format];
  if (!adapter) throw new Error(`Unknown format: ${format}`);

  const mimeType  = MIME_TYPES[format] ?? "application/octet-stream";
  const now       = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
  const filename  = `${entity}-${timestamp}.${format}`;

  // ── Large store: use bulk operations ──────────────────────────────────────
  if (BULK_SUPPORTED.includes(entity)) {
    const count = await getProductCount(admin);

    if (count >= BULK_THRESHOLD) {
      return runBulkExport({ admin, shop, entity, format, filename });
    }
  }

  // ── Small store: direct fetch → format → upload ───────────────────────────
  return runDirectExport({ admin, shop, entity, format, filename, mimeType, adapter });
}

// ─── direct ──────────────────────────────────────────────────────────────────

async function runDirectExport({ admin, shop, entity, format, filename, mimeType, adapter }) {
  const extractor = ENTITY_EXTRACTORS[entity];
  if (!extractor) throw new Error(`Unknown entity: ${entity}`);

  const rows   = await extractor(admin);
  const buffer = adapter(rows);

  const { signedUrl, r2Key, expiresAt } = await uploadToR2({
    buffer, filename, mimeType, shopId: shop,
  });

  return { mode: "direct", signedUrl, filename, expiresAt, r2Key };
}

// ─── bulk ─────────────────────────────────────────────────────────────────────

async function runBulkExport({ admin, shop, entity, format, filename }) {
  // 1. Create a job record in DB
  const job = await createBulkExportJob({ shop, entity, format });

  // 2. Submit the bulk operation to Shopify
  const { bulkOperationId } = await submitProductsBulkOperation(admin);

  // 3. Store the bulk operation ID so the webhook can find this job
  await markJobRunning({ id: job.id, bulkOperationId });

  // 4. Return immediately — the rest happens in the webhook + worker
  return { mode: "bulk", jobId: job.id };
}