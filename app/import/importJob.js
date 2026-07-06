/**
 * import/importJob.js
 *
 * Orchestrator: parse → validate → write.
 * Each stage is independent — swap any one without touching the others.
 */

import { parseCSV } from "./parsers/csv.js";
import { parseXLSX } from "./parsers/xlsx.js";
import { normalizeHeaders, classifyColumns } from "./headers.js";
import { detectEntity, entityFromSheetName } from "./detect.js";
import { summarizeIntent } from "./intent.js";
import { groupRecords } from "./assemble.js";
import { validateProductRows } from "./validators/products.js";
import { validateOrderRows } from "./validators/orders.js";
import { validateCustomerRows } from "./validators/customers.js";
import { validateRedirectRows } from "./validators/redirects.js";
import { upsertProducts } from "./writers/upsertProducts.js";
import { upsertOrders } from "./writers/upsertOrders.js";
import { upsertCustomers } from "./writers/upsertCustomers.js";
import { upsertRedirects } from "./writers/upsertRedirects.js";

/**
 * Parsers normalized to a workbook shape: a file becomes one or more sheets,
 * each `{ name, rows }`. A CSV is a single unnamed sheet; an .xlsx can carry a
 * sheet per entity (Products / Customers / Orders), which is what lets one
 * uploaded file drive many entities the way Matrixify does.
 */
const SHEET_PARSERS = {
  csv:   (buf) => [{ name: null, rows: parseCSV(buf) }],
  xlsx:  (buf) => parseXLSX(buf),
  excel: (buf) => parseXLSX(buf),
  // xml:  (buf) => …,
  // json: (buf) => …,
};

/** @typedef {{ name: string|null, rows: object[] }} Sheet */

/**
 * Parse an uploaded file into sheets.
 * @param {Buffer} fileBuffer
 * @param {string} format
 * @returns {Sheet[]}
 */
export function parseSheets(fileBuffer, format) {
  const parser = SHEET_PARSERS[format];
  if (!parser) throw new Error(`Unsupported format: ${format}`);
  return parser(fileBuffer);
}

const VALIDATORS = {
  products:  validateProductRows,
  orders:    validateOrderRows,
  customers: validateCustomerRows,
  redirects: validateRedirectRows,
};

const WRITERS = {
  products:  upsertProducts,
  orders:    upsertOrders,
  customers: upsertCustomers,
  redirects: upsertRedirects,
};

/** Number of sample rows the analyze step returns for UI preview. */
const SAMPLE_ROW_COUNT = 5;

/**
 * Analyze an uploaded file: parse + validate only. No writes.
 * Used by the import UI's two-step flow to preview what will happen
 * before the merchant confirms.
 *
 * When `entity` is "auto" (or omitted), the entity is detected from the sheet
 * name and/or header row — the Matrixify "just drop the file" behaviour.
 *
 * Never throws for a single unrecognized sheet: returns an analysis with
 * `ok:false` so a multi-sheet workbook can report per-sheet outcomes instead of
 * failing the whole file.
 *
 * @param {object} options
 * @param {object[]} options.rawRows - parsed rows keyed by file header
 * @param {string|null} [options.name] - sheet name (routes by name when present)
 * @param {string} [options.entity="auto"] - entity key, or "auto" to detect
 * @returns {object} per-sheet analysis
 */
export function analyzeSheet({ rawRows, name = null, entity = "auto", include = true }) {
  const rawHeaders = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];

  // Explicit "ignore" (user unticked the sheet) — report it, import nothing.
  if (entity === "ignore" || include === false) {
    return {
      ok: false, included: false, name, entity: entity === "ignore" ? null : entity,
      reason: "Sheet skipped.",
      parsed: rawRows.length, valid: 0, invalid: 0,
      detectedColumns: rawHeaders,
      columns: rawHeaders.map((n) => ({ name: n, known: true })),
      unknownColumns: [],
    };
  }

  // Resolve the entity: explicit choice → sheet-name hint → column detection.
  let detection = null;
  let resolvedEntity = entity;
  if (entity === "auto") {
    const hint = name ? entityFromSheetName(name) : null;
    if (hint && VALIDATORS[hint]) {
      resolvedEntity = hint;
      detection = { entity: hint, supported: true, confidence: "high", via: "sheet name" };
    } else {
      detection = { ...detectEntity(rawHeaders), via: "columns" };
      resolvedEntity = detection.entity;
    }
  }

  const { columns, unknown: unknownColumns } = resolvedEntity
    ? classifyColumns(resolvedEntity, rawHeaders)
    : { columns: rawHeaders.map((n) => ({ name: n, known: false })), unknown: rawHeaders };

  if (!resolvedEntity) {
    return {
      ok: false, included: true, name, entity: null, detection,
      reason: "Columns don't match any known entity.",
      parsed: rawRows.length, valid: 0, invalid: 0,
      detectedColumns: rawHeaders, columns, unknownColumns,
    };
  }

  const validator = VALIDATORS[resolvedEntity];
  if (!validator) {
    return {
      ok: false, included: true, name, entity: resolvedEntity, detection,
      reason: `Importing "${capitalizeEntity(resolvedEntity)}" isn't supported yet.`,
      parsed: rawRows.length, valid: 0, invalid: 0,
      detectedColumns: rawHeaders, columns, unknownColumns,
    };
  }

  // Reverse the export's humanized headers back to snake_case keys so
  // validators/writers read the same keys the export normalizer produced.
  // This is what makes an exported file re-importable (self-consistent
  // round-trip). Unknown/dynamic columns pass through untouched.
  const rows = normalizeHeaders(rawRows, resolvedEntity);
  const { valid, errors: validationErrors } = validator(rows);

  return {
    ok: true,
    included: true,
    name,
    entity: resolvedEntity,
    detection,
    parsed:  rows.length,
    valid:   valid.length,
    invalid: validationErrors.length,
    validationErrors,
    detectedColumns: rawHeaders,
    columns,
    unknownColumns,
    sampleRows: rows.slice(0, SAMPLE_ROW_COUNT),
    intent: summarizeIntent(rows, resolvedEntity),
    validRows:  valid,
  };
}

/**
 * Analyze a whole uploaded file (parse + validate only, no writes). One CSV is a
 * single sheet; an .xlsx may be many. Each sheet is analyzed independently and
 * summed into workbook-level totals for the preview.
 *
 * A per-sheet `plan` (array aligned to the file's non-empty sheet order) lets
 * the merchant override the detected entity or untick a sheet in the preview;
 * the same plan is replayed by the worker so choices actually take effect. Sheet
 * order is deterministic across re-parses, so indexing the plan by position is
 * stable without persisting sheet names.
 *
 * @param {object} options
 * @param {Buffer} options.fileBuffer
 * @param {string} options.format
 * @param {string} [options.entity="auto"] - default entity for every sheet when
 *   no plan entry applies; "auto" detects per sheet.
 * @param {Array<{entity?: string, include?: boolean}>} [options.plan] - per-sheet overrides by index
 * @param {string} [options.filename] - uploaded file name; used as the entity
 *   hint for a single unnamed sheet (a CSV) — "Products.csv" → Products.
 * @returns {{ sheets: object[], totals: object }}
 */
export function analyzeWorkbook({ fileBuffer, format, entity = "auto", plan = null, filename = null }) {
  const parsed = parseSheets(fileBuffer, format);
  // Drop entirely empty sheets (Excel often trails blank ones).
  const nonEmpty = parsed.filter((s) => s.rows.length > 0);
  // A CSV has no sheet name, so fall back to the file name (sans extension) as
  // the entity hint — the way Matrixify routes "Products.csv" to Products.
  const nameFromFile = filename ? String(filename).replace(/\.[^.]+$/, "").trim() : null;
  const sheets = nonEmpty
    .map((s, i) => {
      const p = plan?.[i];
      return analyzeSheet({
        rawRows: s.rows,
        name: s.name ?? (nonEmpty.length === 1 ? nameFromFile : null),
        entity: p?.entity ?? entity,
        include: p?.include ?? true,
      });
    });

  const totals = { parsed: 0, valid: 0, invalid: 0, create: 0, update: 0, delete: 0, skip: 0, importable: 0 };
  for (const s of sheets) {
    totals.parsed += s.parsed ?? 0;
    totals.valid += s.valid ?? 0;
    totals.invalid += s.invalid ?? 0;
    if (s.ok && s.intent) {
      totals.create += s.intent.create;
      totals.update += s.intent.update;
      totals.delete += s.intent.delete;
      totals.skip += s.intent.skip;
      totals.importable += s.valid;
    }
  }

  return { sheets, totals };
}

/**
 * Single-sheet convenience wrapper (CSV / one-shot). Throws when the sole sheet
 * can't be resolved, preserving the older single-entity contract.
 *
 * @returns {object} the sheet analysis, with `validRows` for applyImport().
 */
export function analyzeImport({ fileBuffer, format, entity = "auto" }) {
  const [sheet] = parseSheets(fileBuffer, format);
  const analysis = analyzeSheet({ rawRows: sheet?.rows ?? [], name: sheet?.name ?? null, entity });
  if (!analysis.ok) throw new Error(analysis.reason);
  return analysis;
}

function capitalizeEntity(s) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Apply already-validated rows to Shopify.
 *
 * @param {object} options
 * @param {object[]} options.validRows  - rows that passed validateXxxRows()
 * @param {string}   options.entity
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} options.admin
 * @returns {Promise<{ created: number, updated: number, errors: object[] }>}
 */
export async function applyImport({ validRows, entity, admin, onProgress }) {
  const writer = WRITERS[entity];
  if (!writer) throw new Error(`No writer for entity: ${entity}`);

  if (validRows.length === 0) return { created: 0, updated: 0, deleted: 0, errors: [] };
  return writer(validRows, admin, { onProgress });
}

/**
 * Run a full import job in a single pass (parse → validate → write).
 * The route uses analyzeImport + applyImport directly for the two-step
 * UI; this wrapper exists for callers (scripts, future scheduling) that
 * want a one-shot run.
 *
 * @returns {Promise<{
 *   parsed: number, valid: number, invalid: number,
 *   created: number, updated: number,
 *   validationErrors: object[], writeErrors: object[],
 * }>}
 */
export async function runImportJob({ fileBuffer, format, entity, admin }) {
  const { parsed, valid, invalid, validationErrors, validRows } =
    analyzeImport({ fileBuffer, format, entity });

  const { created, updated, errors: writeErrors } =
    await applyImport({ validRows, entity, admin });

  return { parsed, valid, invalid, created, updated, validationErrors, writeErrors };
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Process a queued background import (the pg-boss worker's entry point).
 * Downloads the staged upload from R2, imports every recognized sheet while
 * streaming progress to the job row, builds a results workbook, uploads it to
 * R2, and marks the job complete. Any failure marks the job failed.
 *
 * Server-only dependencies (DB, R2) are imported dynamically so the pure
 * analyze/parse exports above stay usable in tests without a database.
 *
 * @param {object} options
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} options.admin
 * @param {string} options.shop
 * @param {string} options.jobId
 * @param {Array<{entity?: string, include?: boolean}>} [options.plan] - per-sheet overrides from the preview
 */
export async function runImportForJob({ admin, shop, jobId, plan = null }) {
  const [
    { getImportJob, markImportRunning, updateImportProgress, markImportComplete, markImportFailed },
    { downloadFromR2, putToR2, signDownloadUrl },
    { buildResultsWorkbook },
  ] = await Promise.all([
    import("../db/bulkImportJob.server.js"),
    import("../export/delivery/r2.js"),
    import("./results.js"),
  ]);

  const job = await getImportJob(jobId);
  if (!job) throw new Error(`Import job not found: ${jobId}`);

  try {
    const fileBuffer = await downloadFromR2(job.sourceR2Key);
    const { sheets } = analyzeWorkbook({ fileBuffer, format: job.format, plan, filename: job.filename });

    // Progress is counted in records across the sheets we can actually write.
    const progressTotal = sheets
      .filter((s) => s.ok)
      .reduce((n, s) => n + groupRecords(s.validRows).length, 0);
    await markImportRunning({ id: jobId, progressTotal });

    let done = 0;
    const totals = { created: 0, updated: 0, deleted: 0, failed: 0 };
    const sheetResults = [];

    for (const s of sheets) {
      if (!s.ok) { sheetResults.push(s); continue; }
      const res = await applyImport({
        validRows: s.validRows,
        entity: s.entity,
        admin,
        onProgress: (n) => {
          done += n;
          // Best-effort live update; the final count is set on completion.
          updateImportProgress({ id: jobId, progressCurrent: done }).catch(() => {});
        },
      });
      totals.created += res.created ?? 0;
      totals.updated += res.updated ?? 0;
      totals.deleted += res.deleted ?? 0;
      totals.failed  += res.errors?.length ?? 0;
      sheetResults.push({ ...s, res });
    }

    // Build + upload the results workbook, then hand back a signed download URL.
    const workbook = buildResultsWorkbook(sheetResults);
    const base = (job.filename || "import").replace(/\.[^.]+$/, "");
    const resultKey = `imports/${shop}/results/${job.id}.xlsx`;
    await putToR2({ buffer: workbook, key: resultKey, mimeType: XLSX_MIME });
    const { signedUrl, expiresAt } = await signDownloadUrl(resultKey, `${base}-results.xlsx`);

    await markImportComplete({
      id: jobId,
      created: totals.created,
      updated: totals.updated,
      deleted: totals.deleted,
      failed:  totals.failed,
      resultR2Key: resultKey,
      resultUrl: signedUrl,
      resultUrlExpiry: expiresAt,
      progressCurrent: done,
    });
  } catch (err) {
    await markImportFailed({ id: jobId, errorMessage: err.message });
    throw err; // surface to pg-boss for logging/retry policy
  }
}