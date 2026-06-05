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
import { extractCustomers }            from "./entities/customers.js";
import { extractCollections }          from "./entities/collections.js";
import { extractDiscounts }            from "./entities/discounts.js";
import { extractPages }                from "./entities/pages.js";
import { extractBlogs }                from "./entities/blogs.js";
import { extractArticles }             from "./entities/articles.js";
import { submitBulkOperation,
         getEntityCount,
         BULK_ENTITIES }               from "./entities/bulk.js";
import { toCSV }                       from "./formats/csv.js";
import { toXML }                       from "./formats/xml.js";
import { toJSON }                      from "./formats/json.js";
import { toExcel, toExcelWorkbook }    from "./formats/excel.js";
import { zipParts }                    from "./formats/zip.js";
import { uploadToR2 }                  from "./delivery/r2.js";
import { createBulkExportJob,
         markJobRunning }              from "../db/bulkExportJob.server.js";
import { buildProductQuery,
         buildOrderQuery,
         buildCustomerQuery,
         buildCollectionQuery,
         buildDiscountQuery,
         buildContentQuery }           from "./filters.js";

/** Threshold above which we switch to bulk operations */
const BULK_THRESHOLD = 10_000;

const FORMAT_ADAPTERS = {
  csv:   toCSV,
  xml:   toXML,
  json:  toJSON,
  excel: toExcel,
};

/**
 * Formats the streaming bulk worker can produce line-by-line. Excel is
 * built as a single in-memory workbook, so large-store exports in Excel
 * stay on the direct path instead of routing to bulk operations.
 */
const STREAMABLE_FORMATS = ["csv", "xml", "json"];

const ENTITY_EXTRACTORS = {
  products:    extractProducts,
  orders:      extractOrders,
  customers:   extractCustomers,
  collections: extractCollections,
  discounts:   extractDiscounts,
  pages:       extractPages,
  blogs:       extractBlogs,
  articles:    extractArticles,
};

/** Maps entity → function that builds its Shopify search query */
const QUERY_BUILDERS = {
  products:    buildProductQuery,
  orders:      buildOrderQuery,
  customers:   buildCustomerQuery,
  collections: buildCollectionQuery,
  discounts:   buildDiscountQuery,
  pages:       buildContentQuery,
  blogs:       buildContentQuery,
  articles:    buildContentQuery,
};

const MIME_TYPES = {
  csv:   "text/csv",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml:   "application/xml",
  json:  "application/json",
  zip:   "application/zip",
};

const EXTENSION = {
  csv:   "csv",
  excel: "xlsx",
  xml:   "xml",
  json:  "json",
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
 * @param {object} [options.filters] - row filters (e.g. { status: "active", vendor: "Nike" })
 * @param {string[]} [options.fields] - column selection (defaults to all fields)
 */
export async function runExportJob({ admin, shop, entity, format, filters = {}, fields }) {
  const adapter = FORMAT_ADAPTERS[format];
  if (!adapter) throw new Error(`Unknown format: ${format}`);

  const mimeType  = MIME_TYPES[format] ?? "application/octet-stream";
  const now       = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
  const filename  = `${entity}-${timestamp}.${format}`;

  // Build the Shopify search query from the filter object
  const queryBuilder = QUERY_BUILDERS[entity];
  const query = queryBuilder ? queryBuilder(filters) : "";

  // ── Large store: use bulk operations ──────────────────────────────────────
  // Only stream-friendly formats route to bulk; Excel is built in memory,
  // so it always takes the direct path (see STREAMABLE_FORMATS).
  if (BULK_ENTITIES.includes(entity) && STREAMABLE_FORMATS.includes(format)) {
    const count = await getEntityCount(admin, entity);

    if (count >= BULK_THRESHOLD) {
      return runBulkExport({ admin, shop, entity, format, filename, query, fields });
    }
  }

  // ── Small store: direct fetch → format → upload ───────────────────────────
  return runDirectExport({ admin, shop, entity, format, filename, mimeType, adapter, query, fields });
}

// ─── direct ──────────────────────────────────────────────────────────────────

async function runDirectExport({ admin, shop, entity, format, filename, mimeType, adapter, query, fields }) {
  const extractor = ENTITY_EXTRACTORS[entity];
  if (!extractor) throw new Error(`Unknown entity: ${entity}`);

  const rows   = await extractor(admin, { query });
  const buffer = await adapter(rows, fields); // fields = column selection (undefined = all)

  const { signedUrl, r2Key, expiresAt } = await uploadToR2({
    buffer, filename, mimeType, shopId: shop,
  });

  return { mode: "direct", signedUrl, filename, expiresAt, r2Key };
}

// ─── bulk ─────────────────────────────────────────────────────────────────────

async function runBulkExport({ admin, shop, entity, format, filename, query, fields }) {
  // 1. Create a job record in DB — store the selected fields so the
  //    worker knows which columns to write when the data comes back.
  const job = await createBulkExportJob({
    shop, entity, format,
    fields: fields ? fields.join(",") : null,
  });

  // 2. Submit the bulk operation to Shopify with the row filter applied
  const { bulkOperationId } = await submitBulkOperation(admin, { entity, query });

  // 3. Store the bulk operation ID so the webhook can find this job
  await markJobRunning({ id: job.id, bulkOperationId });

  // 4. Return immediately — the rest happens in the webhook + worker
  return { mode: "bulk", jobId: job.id };
}

// ─── multi-entity ────────────────────────────────────────────────────────────

/**
 * Export multiple entities in one job and bundle them together.
 *
 *   excel        → one multi-sheet workbook (one sheet per entity)
 *   csv/xml/json → one zip containing `<entity>.<ext>` per entity
 *
 * Always uses the direct path — Shopify allows only one bulk operation
 * at a time, so multi-entity jobs can't chain bulk ops cleanly.
 *
 * @param {object} options
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} options.admin
 * @param {string} options.shop
 * @param {{entity: string, filters?: object, fields?: string[]}[]} options.specs
 * @param {string} options.format
 */
export async function runMultiEntityExport({ admin, shop, specs, format }) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("At least one entity must be selected.");
  }
  if (format !== "excel" && !FORMAT_ADAPTERS[format]) {
    throw new Error(`Unknown format: ${format}`);
  }
  for (const s of specs) {
    if (!ENTITY_EXTRACTORS[s.entity]) throw new Error(`Unknown entity: ${s.entity}`);
  }

  // 1. Extract every entity (sequential keeps API load bounded).
  const results = [];
  for (const spec of specs) {
    const buildQuery = QUERY_BUILDERS[spec.entity];
    const query      = buildQuery ? buildQuery(spec.filters ?? {}) : "";
    const extractor  = ENTITY_EXTRACTORS[spec.entity];
    const rows       = await extractor(admin, { query });
    results.push({ entity: spec.entity, rows, fields: spec.fields });
  }

  // 2. Bundle into a single deliverable.
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
  let buffer, filename, mimeType;

  if (format === "excel") {
    buffer = toExcelWorkbook(
      results.map((r) => ({
        name:    capitalize(r.entity),
        rows:    r.rows,
        columns: r.fields,
      })),
    );
    filename = `export-${timestamp}.xlsx`;
    mimeType = MIME_TYPES.excel;
  } else {
    const adapter = FORMAT_ADAPTERS[format];
    const ext     = EXTENSION[format];
    buffer = zipParts(
      results.map((r) => ({
        name: `${r.entity}.${ext}`,
        data: adapter(r.rows, r.fields),
      })),
    );
    filename = `export-${timestamp}.zip`;
    mimeType = MIME_TYPES.zip;
  }

  // 3. Upload + return signed URL.
  const { signedUrl, r2Key, expiresAt } = await uploadToR2({
    buffer, filename, mimeType, shopId: shop,
  });

  return { mode: "direct", signedUrl, filename, expiresAt, r2Key };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}