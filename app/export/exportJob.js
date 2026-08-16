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
import { extractRedirects }            from "./entities/redirects.js";
import { extractGiftCards }            from "./entities/giftCards.js";
import { extractInventory }            from "./entities/inventory.js";
import { extractSellingPlans }         from "./entities/sellingPlans.js";
import { extractMarkets }              from "./entities/markets.js";
import { extractDeliveryProfiles }     from "./entities/deliveryProfiles.js";
import { extractSegments }             from "./entities/segments.js";
import { extractSubscriptions }        from "./entities/subscriptions.js";
import { extractStoreCredit }          from "./entities/storeCredit.js";
import { extractProductMedia }         from "./entities/productMedia.js";
import { extractShop }                 from "./entities/shop.js";
import { extractFiles }                from "./entities/files.js";
import { extractPayouts }              from "./entities/payouts.js";
import { extractMenus }                from "./entities/menus.js";
import { extractCompanies }            from "./entities/companies.js";
import { extractDraftOrders }          from "./entities/draftOrders.js";
import { extractActivity }             from "./entities/activity.js";
import { extractMetaobjects }          from "./entities/metaobjects.js";
import { extractMetafields }           from "./entities/metafields.js";
import { extractTranslations }         from "./entities/translations.js";
import { extractLocations }            from "./entities/locations.js";
import { extractCatalogs }             from "./entities/catalogs.js";
import { extractMetaobjectDefinitions } from "./entities/metaobjectDefinitions.js";
import { extractInventoryTransfers }   from "./entities/inventoryTransfers.js";
import { extractDefinitions }          from "./entities/definitions.js";
import { extractContent }              from "./entities/content.js";
import { submitBulkOperation,
         getEntityCount,
         hasEntityCount,
         BULK_ENTITIES }               from "./entities/bulk.js";
import { toCSV }                       from "./formats/csv.js";
import { toXML }                       from "./formats/xml.js";
import { toJSON }                      from "./formats/json.js";
import { toExcel, toExcelWorkbook, entitySheetName } from "./formats/excel.js";
import { toPDF, toPDFDocument }        from "./formats/pdf.js";
import { toShopifyCSV }                from "./formats/shopifyCsv.js";
import { toGoogleFeed }                from "./formats/googleFeed.js";
import { zipParts }                    from "./formats/zip.js";
import { uploadToR2 }                  from "./delivery/r2.js";
import { createBulkExportJob,
         markJobRunning,
         markJobComplete,
         markJobFailed,
         markJobCancelled,
         isJobCancelRequested,
         updateJobProgress,
         getJob }                      from "../db/bulkExportJob.server.js";
import { enqueueExport }               from "../queue/exportQueue.server.js";
import { FIELDS_BY_ENTITY }            from "./fieldLists.js";
import { buildProductQuery,
         buildOrderQuery,
         buildCustomerQuery,
         buildCollectionQuery,
         buildDiscountQuery,
         buildContentQuery,
         buildRedirectQuery,
         buildFileQuery,
         buildCompanyQuery,
         buildDraftOrderQuery }        from "./filters.js";
import { applyAdvancedFilters, activeAdvancedFilters } from "./advancedFilters.js";

/** Threshold above which we switch to bulk operations */
const BULK_THRESHOLD = 10_000;

// Adapters take (rows, columns, entity, ctx). `entity` matters only to
// dialects with a fixed per-entity layout (Shopify CSV, Google feed); `ctx`
// carries shop facts a feed needs (currency, domain) — the rest ignore both.
const FORMAT_ADAPTERS = {
  csv:   toCSV,
  xml:   toXML,
  json:  toJSON,
  excel: toExcel,
  pdf:   toPDF,
  csv_shopify: toShopifyCSV,
  google_feed: toGoogleFeed,
};

// Google's feed wants a currency on every price and absolute links — facts
// that live on the shop, not the rows. Fetched once per run, only for the
// format that needs them; failure degrades the feed, never the export.
const FEED_CONTEXT_QUERY = `#graphql
  query FeedContext { shop { name currencyCode primaryDomain { host } } }
`;
async function feedContext(admin, format) {
  if (format !== "google_feed") return {};
  try {
    const response = await admin.graphql(FEED_CONTEXT_QUERY);
    const shop = (await response.json()).data?.shop;
    return {
      shopName: shop?.name ?? "",
      currency: shop?.currencyCode ?? "",
      domain:   shop?.primaryDomain?.host ?? "",
    };
  } catch {
    return {};
  }
}

/**
 * Formats the streaming bulk worker can produce line-by-line. Excel and
 * PDF are built as single in-memory documents, so large-store exports in
 * those formats stay on the direct path instead of routing to bulk
 * operations.
 */
const STREAMABLE_FORMATS = ["csv", "xml", "json"];

const ENTITY_EXTRACTORS = {
  products:    extractProducts,
  orders:      extractOrders,
  customers:   extractCustomers,
  collections: extractCollections,
  smart_collections:  extractCollections,
  custom_collections: extractCollections,
  discounts:   extractDiscounts,
  pages:       extractPages,
  blogs:       extractBlogs,
  articles:    extractArticles,
  redirects:   extractRedirects,
  gift_cards:  extractGiftCards,
  inventory:          extractInventory,
  selling_plans:      extractSellingPlans,
  markets:            extractMarkets,
  delivery_profiles:  extractDeliveryProfiles,
  segments:           extractSegments,
  subscriptions:      extractSubscriptions,
  store_credit:       extractStoreCredit,
  product_media:      extractProductMedia,
  shop:        extractShop,
  files:       extractFiles,
  payouts:     extractPayouts,
  menus:       extractMenus,
  companies:   extractCompanies,
  draft_orders: extractDraftOrders,
  activity:    extractActivity,
  metaobjects: extractMetaobjects,
  metafields:  extractMetafields,
  translations: extractTranslations,
  locations:   extractLocations,
  catalogs:    extractCatalogs,
  metaobject_definitions: extractMetaobjectDefinitions,
  inventory_transfers: extractInventoryTransfers,
  definitions: extractDefinitions,
  content:     extractContent,
};

/** Maps entity → function that builds its Shopify search query */
const QUERY_BUILDERS = {
  products:    buildProductQuery,
  orders:      buildOrderQuery,
  customers:   buildCustomerQuery,
  collections: buildCollectionQuery,
  smart_collections:  (f) => buildCollectionQuery({ ...f, collectionType: "smart" }),
  custom_collections: (f) => buildCollectionQuery({ ...f, collectionType: "custom" }),
  discounts:   buildDiscountQuery,
  pages:       buildContentQuery,
  blogs:       buildContentQuery,
  articles:    buildContentQuery,
  redirects:   buildRedirectQuery,
  files:       buildFileQuery,
  companies:   buildCompanyQuery,
  draft_orders: buildDraftOrderQuery,
  content:     buildContentQuery,
};

const MIME_TYPES = {
  csv:   "text/csv",
  csv_shopify: "text/csv",
  google_feed: "application/xml",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml:   "application/xml",
  json:  "application/json",
  pdf:   "application/pdf",
  zip:   "application/zip",
};

const EXTENSION = {
  csv:   "csv",
  csv_shopify: "csv",
  google_feed: "xml",
  excel: "xlsx",
  xml:   "xml",
  json:  "json",
  pdf:   "pdf",
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
  const timestamp = now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  const filename  = `${capitalize(entity)}-${timestamp}.${EXTENSION[format] ?? format}`;

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
  const ctx = await feedContext(admin, format);
  return runDirectExport({ admin, shop, entity, filename, mimeType, adapter, query, fields, ctx });
}

// ─── direct ──────────────────────────────────────────────────────────────────

async function runDirectExport({ admin, shop, entity, filename, mimeType, adapter, query, fields, ctx = {} }) {
  const extractor = ENTITY_EXTRACTORS[entity];
  if (!extractor) throw new Error(`Unknown entity: ${entity}`);

  const rows   = await extractor(admin, { query, fields, shop }); // fields toggles the products inventory fetch; shop used by Activity
  const buffer = await adapter(rows, fields, entity, ctx); // fields = column selection (undefined = all)

  const { signedUrl, r2Key, expiresAt } = await uploadToR2({
    buffer, filename, mimeType, shopId: shop,
  });

  return { mode: "direct", signedUrl, filename, expiresAt, r2Key };
}

// ─── bulk ─────────────────────────────────────────────────────────────────────

async function runBulkExport({ admin, shop, entity, format, query, fields }) {
  // 1. Create a job record in DB — store the selected fields so the
  //    worker knows which columns to write when the data comes back.
  const job = await createBulkExportJob({
    shop, entity, format,
    fields: fields ? fields.join(",") : null,
  });

  // 2. Submit the bulk operation to Shopify with the row filter applied.
  //    `fields` toggles the per-location inventory sub-selection.
  const { bulkOperationId } = await submitBulkOperation(admin, { entity, query, fields });

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
    const fetched    = await extractor(admin, { query, fields: spec.fields, shop });
    // Advanced filters (column/operator/value) can't be expressed as a Shopify
    // query, so they're applied to the fetched rows per record.
    const rows       = applySort(applyAdvancedFilters(fetched, spec.advancedFilters), spec.sort);
    results.push({ entity: spec.entity, rows, fields: spec.fields });
  }

  // 2. Bundle into a single deliverable.
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  let buffer, filename, mimeType;

  if (format === "excel") {
    buffer = toExcelWorkbook(
      results.map((r) => ({
        name:    entitySheetName(r.entity),
        rows:    r.rows,
        columns: r.fields,
      })),
    );
    filename = `Export-${timestamp}.xlsx`;
    mimeType = MIME_TYPES.excel;
  } else if (format === "pdf") {
    buffer = toPDFDocument(
      results.map((r) => ({
        name:    entitySheetName(r.entity),
        rows:    r.rows,
        columns: r.fields,
      })),
    );
    filename = `Export-${timestamp}.pdf`;
    mimeType = MIME_TYPES.pdf;
  } else {
    const adapter = FORMAT_ADAPTERS[format];
    const ext     = EXTENSION[format];
    const ctx     = await feedContext(admin, format);
    buffer = zipParts(
      results.map((r) => ({
        name: `${capitalize(r.entity)}.${ext}`,
        data: adapter(r.rows, r.fields, r.entity, ctx),
      })),
    );
    filename = `Export-${timestamp}.zip`;
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

/**
 * Column list for a result: the user's selection when given; otherwise, for
 * an EMPTY result, the entity's full field list — so an entity with no
 * records still exports a file with a proper header row instead of 0 bytes.
 * (Non-empty results keep deriving columns from the data, which includes
 * dynamic per-store columns a static list can't know.)
 */
function columnsFor(r) {
  if (r.fields?.length) return r.fields;
  if (r.rows.length === 0) return FIELDS_BY_ENTITY[r.entity] ?? undefined;
  return undefined;
}

/** True when a row starts a new record (entities that don't explode: always). */
const isRecordStart = (row) =>
  row.top_row == null || String(row.top_row).toLowerCase() === "true";

/**
 * Sort rows by one or more columns WITHOUT breaking multi-row records apart —
 * products and orders explode into several rows, so whole records are
 * reordered by their top row's values. Rules apply in order: the second
 * breaks the first's ties, and so on. Numeric-aware, then locale compare.
 * Accepts an array of { column, direction } rules or the legacy single object.
 */
function applySort(rows, sort) {
  const rules = (Array.isArray(sort) ? sort : sort ? [sort] : []).filter((r) => r?.column);
  if (rules.length === 0) return rows;
  const groups = [];
  let current = null;
  for (const row of rows) {
    if (!current || isRecordStart(row)) {
      current = [];
      groups.push(current);
    }
    current.push(row);
  }
  const compareBy = (a, b, rule) => {
    const av = a[0]?.[rule.column];
    const bv = b[0]?.[rule.column];
    const an = Number(av);
    const bn = Number(bv);
    const bothNumeric = String(av ?? "").trim() !== "" && String(bv ?? "").trim() !== ""
      && Number.isFinite(an) && Number.isFinite(bn);
    const cmp = bothNumeric
      ? an - bn
      : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" });
    return cmp * (rule.direction === "desc" ? -1 : 1);
  };
  groups.sort((a, b) => {
    for (const rule of rules) {
      const cmp = compareBy(a, b, rule);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return groups.flat();
}

// ISO date-time strings as Shopify emits them (2026-08-07T02:07:04Z / offset).
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** Render an ISO date-time in one of the offered patterns (UTC parts). */
function formatIsoDate(value, pattern) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = (n) => String(n).padStart(2, "0");
  const Y = d.getUTCFullYear(), M = p(d.getUTCMonth() + 1), D = p(d.getUTCDate());
  const h = p(d.getUTCHours()), m = p(d.getUTCMinutes()), s = p(d.getUTCSeconds());
  switch (pattern) {
    case "YYYY-MM-DD HH:MM:SS": return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    case "YYYY-MM-DD":          return `${Y}-${M}-${D}`;
    case "DD.MM.YYYY HH:MM:SS": return `${D}.${M}.${Y} ${h}:${m}:${s}`;
    case "DD.MM.YYYY HH:MM":    return `${D}.${M}.${Y} ${h}:${m}`;
    case "MM/DD/YYYY HH:MM:SS": return `${M}/${D}/${Y} ${h}:${m}:${s}`;
    case "MM/DD/YYYY HH:MM":    return `${M}/${D}/${Y} ${h}:${m}`;
    default: return value;
  }
}

/**
 * Advanced → Formatting: rewrite cell values before any file is built.
 *  - excelDates (Excel only): date columns become "YYYY-MM-DD HH:MM:SS" — the
 *    timezone-less shape Excel recognizes as a date-time.
 *  - dateFormat: every ISO date-time re-rendered in the chosen pattern.
 *  - apostrophe: which values get a ' prefix so spreadsheet apps keep them as
 *    literal text — "phones" (phone columns), "numbers" (digit-only values,
 *    e.g. barcodes and zips with leading zeros), or "all". Tabular formats
 *    only. Legacy boolean true (early jobs) means "all".
 */
function applyValueFormatting(rows, format, options = {}) {
  const excelDates = Boolean(options.excelDates) && format === "excel";
  const dateFormat = options.dateFormat || "";
  const tabular = format === "csv" || format === "csv_shopify" || format === "excel";
  const apMode = tabular
    ? (options.apostrophe === true ? "all" : options.apostrophe || "")
    : "";
  if (!excelDates && !dateFormat && !apMode) return rows;
  const wantsApostrophe = (key, val) => {
    if (!apMode || typeof val !== "string" || val === "") return false;
    if (apMode === "all") return true;
    if (apMode === "phones") return key.includes("phone");
    if (apMode === "numbers") return /^\d+$/.test(val);
    return false;
  };
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      let val = v;
      if (typeof val === "string" && val && ISO_DATETIME.test(val)) {
        if (excelDates) val = formatIsoDate(val, "YYYY-MM-DD HH:MM:SS");
        else if (dateFormat) val = formatIsoDate(val, dateFormat);
      }
      if (wantsApostrophe(k, val)) val = `'${val}`;
      out[k] = val;
    }
    return out;
  });
}

/**
 * Split rows into chunks of about `size` records WITHOUT breaking a
 * multi-row record apart — products and orders explode into several rows
 * that must travel together, marked by `top_row` on the first one.
 *
 * @returns {object[][]} one chunk when splitting is off or unnecessary
 */
export function chunkRows(rows, size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0 || rows.length <= n) return [rows];

  const chunks = [];
  let current = [];
  for (const row of rows) {
    if (current.length >= n && isRecordStart(row)) {
      chunks.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// ─── tracked (in-process background) export with progress ──────────────────────

/**
 * Entry point for the progress-bar export flow. Decides between:
 *   - Shopify bulk operations (huge single-entity streamable exports), or
 *   - an in-process tracked job that reports determinate progress.
 * Always returns `{ mode: "job", jobId }` (or `{ mode: "bulk", jobId }`); the
 * UI polls the job either way.
 */
export async function startExport({ admin, shop, specs, format, splitRows = null, options = {}, jobId = undefined }) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("At least one entity must be selected.");
  }
  // Nothing slow happens here: the job row is created and queued immediately
  // so the UI can jump to the job page; the tracked-vs-Shopify-bulk decision
  // (an Admin count query) runs in the worker instead.
  return startTrackedExport({ admin, shop, specs, format, splitRows, options, jobId });
}

/**
 * Huge single-entity streamable exports still go through Shopify's bulk
 * operations (they can't be held in memory) — but the decision needs an
 * Admin count query, so it runs HERE in the worker, off the click's critical
 * path. Returns true when the job was handed to a Shopify bulk operation;
 * the bulk-operations webhook + worker complete the job from there.
 *
 * Advanced filters (column/operator/value) are applied to fetched rows,
 * which the bulk/streaming path never materializes — those stay on the
 * tracked path, the same way multi-entity always does.
 */
async function maybeRouteToShopifyBulk({ admin, job, specs, format }) {
  if (specs.length !== 1) return false;
  const s = specs[0];
  if (!STREAMABLE_FORMATS.includes(format) || !BULK_ENTITIES.includes(s.entity)) return false;
  if (activeAdvancedFilters(s.advancedFilters).length > 0) return false;
  const count = await safeCount(admin, s.entity);
  if (count == null || count < BULK_THRESHOLD) return false;

  const query = QUERY_BUILDERS[s.entity]?.(s.filters ?? {}) ?? "";
  const { bulkOperationId } = await submitBulkOperation(admin, { entity: s.entity, query, fields: s.fields });
  await markJobRunning({ id: job.id, bulkOperationId });
  // Shopify reports no incremental progress for bulk operations — mark the
  // total as uncountable so the UI pulses rather than waiting for a number.
  await updateJobProgress({ id: job.id, progressTotal: -1 }).catch(() => {});
  return true;
}

/** getEntityCount, but never throws — returns null for uncountable entities. */
async function safeCount(admin, entity) {
  try {
    return await getEntityCount(admin, entity);
  } catch {
    return null;
  }
}

async function startTrackedExport({ admin, shop, specs, format, splitRows = null, options = {}, jobId = undefined }) {
  let job;
  try {
    job = await createBulkExportJob({
      id: jobId,
      shop,
      entity: specs.map((s) => s.entity).join(","),
      format,
      // v2 envelope: options + splitRows ride along so the run page can
      // display the configuration that actually ran (parse with parseJobSpec).
      spec: { v: 2, specs, options, splitRows },
      // Stored so the bulk-operations worker knows the column selection if the
      // worker later routes this job to a Shopify bulk operation.
      fields: specs.length === 1 && specs[0].fields ? specs[0].fields.join(",") : null,
      progressTotal: null,
    });
  } catch (err) {
    // The optimistic job page retries its start on refresh — same id landing
    // twice means the job already exists; that's a success, not an error.
    if (jobId && err?.code === "P2002") return { mode: "job", jobId };
    throw err;
  }

  // Seed the progress bar's total in the background — the Admin count
  // queries would otherwise sit on the click's critical path and delay the
  // jump to the job page. Until it lands the total stays null ("still
  // counting"); -1 marks "genuinely uncountable" so the UI knows to pulse
  // instead of waiting for a number that will never come. An entity WITHOUT
  // a real count query makes the whole total unknown — getEntityCount's 0
  // fallback once produced totals smaller than the progress ("116 of 58").
  void (async () => {
    const perEntity = await Promise.all(specs.map(async (s) => {
      if (!hasEntityCount(s.entity)) return null;
      const c = await safeCount(admin, s.entity);
      return Number.isFinite(c) ? c : null;
    }));
    const progressTotal = perEntity.every((c) => c != null)
      ? perEntity.reduce((sum, c) => sum + c, 0)
      : -1;
    await updateJobProgress({ id: job.id, progressTotal });
  })().catch(() => {});

  // Durable path: hand the job to pg-boss so it survives a server restart. If
  // the queue is unavailable, fall back to processing in-process on this
  // request so exports still work (just without restart-durability).
  try {
    await enqueueExport({ jobId: job.id, specs, format, shop, splitRows, options });
  } catch (err) {
    console.warn("[export] queue unavailable, running in-process:", err.message);
    (async () => {
      if (await maybeRouteToShopifyBulk({ admin, job, specs, format })) return;
      await processTrackedExport({ admin, shop, job, specs, format, splitRows, options });
    })().catch(async (e) => {
      await markJobFailed({ id: job.id, errorMessage: e.message }).catch(() => {});
    });
  }

  return { mode: "job", jobId: job.id };
}

/**
 * Process a queued export by its DB id — the pg-boss worker entry point. The
 * worker supplies an admin client reconstructed from the shop's offline
 * session (it has no request of its own).
 */
export async function runExportForJob({ admin, shop, jobId, specs, format, splitRows = null, options = {} }) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Export job not found: ${jobId}`);
  try {
    // Huge stores hand off to a Shopify bulk operation here (webhook-driven
    // from that point); everyone else runs the tracked path.
    if (await maybeRouteToShopifyBulk({ admin, job, specs, format })) return;
    await processTrackedExport({ admin, shop, job, specs, format, splitRows, options });
  } catch (err) {
    await markJobFailed({ id: jobId, errorMessage: err.message }).catch(() => {});
    throw err;
  }
}

/**
 * Advanced-options filename template: {date}, {time} and {shop} placeholders,
 * sanitized for filesystems, with the format's extension appended when the
 * template doesn't already end in it.
 */
export function renderExportFilename(template, { shop = "", ext = "csv", now = new Date() } = {}) {
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 16).replace(":", "");
  let out = String(template).trim()
    .replace(/\{date\}/gi, date)
    .replace(/\{time\}/gi, time)
    .replace(/\{shop\}/gi, String(shop).replace(/\.myshopify\.com$/i, ""))
    .replace(/[\\/:*?"<>|]+/g, "_");
  if (!new RegExp(`\\.${ext}$`, "i").test(out)) out += `.${ext}`;
  return out;
}

/**
 * Post-run delivery chosen up-front in Options: push the finished file to a
 * saved server and/or email it. Runs server-side after the job completes, so
 * it works even if the browser tab was closed mid-export. A delivery failure
 * never fails the job — the file is already exported and downloadable.
 */
async function deliverAfterExport({ shop, options, filename, body, mimeType }) {
  const target = String(options.deliverTarget || "");
  const path = String(options.deliverPath || "");
  if (target) {
    const { getImportServer } = await import("../db/importServer.server.js");
    const server = await getImportServer(shop, target);
    if (server && server.protocol !== "https") {
      if (server.protocol === "s3") {
        const { uploadToS3 } = await import("../schedules/delivery.server.js");
        await uploadToS3({
          bucket: server.host,
          region: server.region || "us-east-1",
          accessKeyId: server.username,
          secretAccessKey: server.password,
          prefix: path,
        }, { filename, body, contentType: mimeType });
      } else {
        const { uploadToFtp } = await import("../schedules/delivery.server.js");
        await uploadToFtp({
          protocol: server.protocol,
          host: server.host,
          port: server.port,
          user: server.username,
          password: server.password,
          path,
        }, { filename, body });
      }
    }
  } else if (options.deliverUrl) {
    // Ad-hoc destination typed as a URL — credentials ride in the URL itself
    // (ftp://user:pass@host/folder), used once and never saved.
    try {
      const u = new URL(String(options.deliverUrl));
      const protocol = u.protocol.replace(/:$/, "").toLowerCase();
      if (["ftp", "ftps", "sftp"].includes(protocol)) {
        const { uploadToFtp } = await import("../schedules/delivery.server.js");
        await uploadToFtp({
          protocol,
          host: u.hostname,
          port: u.port ? Number(u.port) : undefined,
          user: decodeURIComponent(u.username || ""),
          password: decodeURIComponent(u.password || ""),
          path: decodeURIComponent(u.pathname || ""),
        }, { filename, body });
      }
    } catch { /* an unparsable URL just skips delivery — the file is exported */ }
  }
  if (options.emailTo?.trim()) {
    const { sendScheduleEmail } = await import("../schedules/mailer.server.js");
    await sendScheduleEmail({
      to: options.emailTo,
      subject: `SyncifyPro export — ${filename}`,
      text: `Your export "${filename}" is attached.`,
      attachment: { filename, body, contentType: mimeType },
    });
  }
}

/**
 * On completion the records actually processed become both the bar's current
 * AND its total, so it lands on exactly 100%. Anything else can leave it
 * short: the seeded total may be stale (background counting), inflated
 * (counts ignore row filters), or the entity may have no progress callback
 * at all. Two updates because the monotonic progressCurrent guard would
 * otherwise swallow the progressTotal write.
 */
async function snapProgressFull(jobId, processed) {
  await updateJobProgress({ id: jobId, progressCurrent: processed }).catch(() => {});
  if (processed > 0) {
    await updateJobProgress({ id: jobId, progressTotal: processed }).catch(() => {});
  }
}

/** Thrown when the user pressed Cancel — caught to mark the job cancelled. */
class ExportCancelled extends Error {}

async function processTrackedExport({ admin, shop, job, specs, format, splitRows = null, options = {} }) {
  await markJobRunning({ id: job.id, bulkOperationId: null });

  try {
    await processTrackedExportInner({ admin, shop, job, specs, format, splitRows, options });
  } catch (err) {
    if (err instanceof ExportCancelled) {
      await markJobCancelled({ id: job.id }).catch(() => {});
      return;
    }
    throw err;
  }
}

async function processTrackedExportInner({ admin, shop, job, specs, format, splitRows = null, options = {} }) {
  // Bail between entities when the user pressed Cancel.
  const checkCancelled = async () => {
    if (await isJobCancelRequested(job.id)) throw new ExportCancelled();
  };

  // Extract every entity, streaming progress (records fetched) into the job.
  let base = 0; // records completed from prior entities
  const results = [];
  for (const spec of specs) {
    await checkCancelled();
    const query     = QUERY_BUILDERS[spec.entity] ? QUERY_BUILDERS[spec.entity](spec.filters ?? {}) : "";
    const extractor = ENTITY_EXTRACTORS[spec.entity];
    let entityDone  = 0;
    const fetched = await extractor(admin, {
      query, fields: spec.fields, shop,
      onProgress: (n) => {
        entityDone = n;
        updateJobProgress({ id: job.id, progressCurrent: base + n }).catch(() => {});
      },
    });
    base += entityDone;
    // Advanced filters (column/operator/value) are applied to the fetched rows
    // per record — they can't be pushed down into the Shopify query.
    const rows = applySort(applyAdvancedFilters(fetched, spec.advancedFilters), spec.sort);
    results.push({ entity: spec.entity, rows, fields: spec.fields });
  }

  // Last chance to bail before the (potentially large) bundle + upload.
  await checkCancelled();

  // Advanced → Formatting options rewrite cell values before any file is built.
  for (const r of results) r.rows = applyValueFormatting(r.rows, format, options);

  // Bundle: single entity → one file; multiple → zip (or one Excel workbook).
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  const rowCount = results.reduce((sum, r) => sum + r.rows.length, 0);
  let buffer, filename, mimeType;

  // Split into N-row parts when asked. Splitting always yields a zip, since
  // one job still delivers exactly one file.
  const parts = [];
  for (const r of results) {
    const ext = EXTENSION[format];
    const chunks = chunkRows(r.rows, splitRows);
    for (const [i, chunk] of chunks.entries()) {
      parts.push({
        entity: r.entity,
        name: chunks.length > 1
          ? `${r.entity}-part-${String(i + 1).padStart(2, "0")}.${ext}`
          : `${r.entity}.${ext}`,
        rows: chunk,
        columns: columnsFor(r),
      });
    }
  }
  const wasSplit = parts.length > results.length;

  // Feed facts for google_feed + the Advanced CSV dialect options, one ctx.
  const feedCtx = await feedContext(admin, format);
  const adapterCtx = { ...(feedCtx ?? {}), csv: options.csv ?? undefined };

  if (results.length === 1 && !wasSplit) {
    const r   = results[0];
    const ext = EXTENSION[format];
    buffer    = await FORMAT_ADAPTERS[format](r.rows, columnsFor(r), r.entity, adapterCtx);
    filename  = `${capitalize(r.entity)}-${timestamp}.${ext}`;
    mimeType  = MIME_TYPES[format] ?? "application/octet-stream";
  } else if (format === "excel" && !wasSplit) {
    buffer   = toExcelWorkbook(results.map((r) => ({ name: entitySheetName(r.entity), rows: r.rows, columns: columnsFor(r) })));
    filename = `Export-${timestamp}.xlsx`;
    mimeType = MIME_TYPES.excel;
  } else if (format === "pdf" && !wasSplit) {
    buffer   = toPDFDocument(results.map((r) => ({ name: entitySheetName(r.entity), rows: r.rows, columns: columnsFor(r) })));
    filename = `Export-${timestamp}.pdf`;
    mimeType = MIME_TYPES.pdf;
  } else {
    const entries = [];
    for (const p of parts) {
      entries.push({
        name: p.name,
        data: format === "excel"
          ? toExcelWorkbook([{ name: entitySheetName(p.entity), rows: p.rows, columns: p.columns }])
          : format === "pdf"
            ? toPDFDocument([{ name: entitySheetName(p.entity), rows: p.rows, columns: p.columns }])
            : await FORMAT_ADAPTERS[format](p.rows, p.columns, p.entity, adapterCtx),
      });
    }
    buffer   = zipParts(entries);
    filename = `Export-${timestamp}.zip`;
    mimeType = MIME_TYPES.zip;
  }

  // ── Advanced options ──────────────────────────────────────────────────────
  // Skip the file entirely when there's nothing to write (a scheduled feed
  // pattern: no data → no file, rather than an empty one).
  if (options.skipEmpty && rowCount === 0) {
    await snapProgressFull(job.id, base);
    await markJobComplete({ id: job.id, r2Key: null, signedUrl: null, signedUrlExpiry: null, rowCount: 0 });
    return;
  }

  // Custom file name with {date}/{time}/{shop} placeholders. The time source
  // (Matrixify parity) picks which timestamp fills them: the run's start
  // (default) or this moment, when it finished.
  if (options.filename?.trim()) {
    const ext = filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? EXTENSION[format] ?? "csv";
    const at = options.filenameTimeSource === "finished"
      ? new Date()
      : new Date(job.createdAt ?? Date.now());
    filename = renderExportFilename(options.filename, { shop, ext, now: at });
  }

  // Force-zip: wrap whatever was produced (unless it already is a zip).
  if (options.zip && mimeType !== MIME_TYPES.zip) {
    buffer   = zipParts([{ name: filename, data: buffer }]);
    filename = filename.replace(/\.[a-z0-9]+$/i, "") + ".zip";
    mimeType = MIME_TYPES.zip;
  }

  const { signedUrl, r2Key, expiresAt } = await uploadToR2({ buffer, filename, mimeType, shopId: shop });

  // Snap the bar to exactly full and mark done.
  await snapProgressFull(job.id, base);
  await markJobComplete({ id: job.id, r2Key, signedUrl, signedUrlExpiry: expiresAt, rowCount });

  if (options.deliverTarget || options.deliverUrl || options.emailTo?.trim()) {
    try {
      await deliverAfterExport({ shop, options, filename, body: buffer, mimeType });
    } catch (err) {
      console.warn("[export] post-run delivery failed:", err.message);
    }
  }
}