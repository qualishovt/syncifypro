/**
 * import/importJob.js
 *
 * Orchestrator: parse → validate → write.
 * Each stage is independent — swap any one without touching the others.
 */

import { parseCSV } from "./parsers/csv.js";
import { parseXLSX } from "./parsers/xlsx.js";
import { unzip } from "./parsers/unzip.js";
import { normalizeHeaders, classifyColumns, reverseHeaderMap } from "./headers.js";
import { detectEntity, entityFromSheetName } from "./detect.js";
import { isEntityBlocked } from "../export/fieldLists.js";
import { summarizeIntent, classifyRecord, identityKeys } from "./intent.js";
import { groupRecords, topRow } from "./assemble.js";
import { activeAdvancedFilters, matchesAdvancedFilters } from "../export/advancedFilters.js";
import { validateProductRows } from "./validators/products.js";
import { validateOrderRows } from "./validators/orders.js";
import { validateCustomerRows } from "./validators/customers.js";
import { validateRedirectRows } from "./validators/redirects.js";
import { validateGiftCardRows } from "./validators/giftCards.js";
import { validateCollectionRows } from "./validators/collections.js";
import { validateDiscountRows } from "./validators/discounts.js";
import { upsertProducts } from "./writers/upsertProducts.js";
import { upsertOrders } from "./writers/upsertOrders.js";
import { upsertCustomers } from "./writers/upsertCustomers.js";
import { upsertRedirects } from "./writers/upsertRedirects.js";
import { upsertGiftCards } from "./writers/upsertGiftCards.js";
import { upsertCollections } from "./writers/upsertCollections.js";
import { upsertDiscounts } from "./writers/upsertDiscounts.js";

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
  // A ZIP of CSVs and/or Excel workbooks (what the multi-entity csv export —
  // or a bundled folder import — produces): each .csv entry becomes a named
  // sheet and each .xlsx entry contributes its own sheets, so the zip imports
  // like one multi-sheet workbook. Entity detection stays header-based.
  zip:   (buf) => {
    const sheets = [];
    for (const [name, data] of unzip(buf).entries()) {
      if (!data.length) continue;
      const base = name.replace(/^.*\//, "");
      if (/\.csv$/i.test(base)) {
        sheets.push({ name: base.replace(/\.csv$/i, ""), rows: parseCSV(data) });
      } else if (/\.xlsx$/i.test(base)) {
        for (const s of parseXLSX(data)) sheets.push(s);
      }
    }
    if (!sheets.length) throw new Error("The ZIP contains no .csv or .xlsx files to import.");
    return sheets;
  },
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
  products:    validateProductRows,
  orders:      validateOrderRows,
  customers:   validateCustomerRows,
  redirects:   validateRedirectRows,
  gift_cards:  validateGiftCardRows,
  collections: validateCollectionRows,
  discounts:   validateDiscountRows,
};

const WRITERS = {
  products:    upsertProducts,
  orders:      upsertOrders,
  customers:   upsertCustomers,
  redirects:   upsertRedirects,
  gift_cards:  upsertGiftCards,
  collections: upsertCollections,
  discounts:   upsertDiscounts,
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
export function analyzeSheet({ rawRows, name = null, entity = "auto", include = true, filters = null, selectedColumns = null, excludedColumns = null, blockedEntities = [] }) {
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

  // Sheet Permissions (Settings): a blocked entity can't be imported —
  // including via a parent permission (blocked "content" gates articles etc.).
  if (isEntityBlocked(resolvedEntity, blockedEntities)) {
    return {
      ok: false, included: true, name, entity: resolvedEntity, detection,
      reason: `Importing "${capitalizeEntity(resolvedEntity)}" is disabled in Sheet Permissions (Settings).`,
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
  const allRows = normalizeHeaders(rawRows, resolvedEntity);
  // Row filters (from the plan) drop non-matching records before validation.
  const filtered = applyRowFilters(allRows, filters);
  // Column selection (from the plan) strips unselected fields so the writer
  // only touches the columns the merchant chose (identity + Command always kept).
  const rows = selectColumns(filtered, resolvedEntity, selectedColumns, excludedColumns);
  const { valid, errors: validationErrors } = validator(rows);

  // Filterable/selectable columns: humanized label → the snake_case key.
  const revMap = safeReverseMap(resolvedEntity);
  const filterColumns = rawHeaders.map((h) => ({ key: revMap.get(h) ?? h, label: h }));

  return {
    ok: true,
    included: true,
    name,
    entity: resolvedEntity,
    detection,
    parsed:  allRows.length,
    // Records, not rows — a product's variant/image rows collapse into one.
    records: groupRecords(rows).length,
    // Valid RECORDS — the unit the writers report progress in, so a job's
    // progress total counts the same thing as its progress current.
    validRecords: groupRecords(valid).length,
    filteredOut: allRows.length - rows.length,
    valid:   valid.length,
    invalid: validationErrors.length,
    validationErrors,
    detectedColumns: rawHeaders,
    columns,
    unknownColumns,
    filterColumns,
    sampleRows: rows.slice(0, SAMPLE_ROW_COUNT),
    intent: summarizeIntent(rows, resolvedEntity),
    validRows:  valid,
  };
}

function safeReverseMap(entity) {
  try { return reverseHeaderMap(entity); } catch { return new Map(); }
}

// Operator names from plans saved before row filters adopted the export
// page's operator set — mapped onto their "any of" equivalents.
const LEGACY_FILTER_OPS = {
  equals: "equals_any",
  not_equal: "not_equal_any",
  contains: "contains_any",
  not_contains: "contains_none",
  starts_with: "starts_with_any",
};

// Keys that must survive column selection regardless of the merchant's choice:
// the Command drives create/update/delete, top_row assembles variant groups.
const ALWAYS_KEEP = ["command", "top_row"];

/**
 * Narrow what the writer touches, so unselected fields stay as they are on the
 * existing object. Two ways of saying it, because they mean different things
 * when the file changes:
 *
 * - `excluded`: the columns deliberately left out. Anything else is imported,
 *   INCLUDING a column this plan never saw — a preset from last week must not
 *   silently drop a column this week's file added.
 * - `columns` (legacy): the columns to keep, from plans saved before the
 *   above. A column missing from that list is dropped, as it was then.
 *
 * Identity and structural keys (Command, Top Row, handle/id) survive either
 * way: without them a row can't be matched or assembled.
 */
function selectColumns(rows, entity, columns, excluded) {
  const pinned = new Set([...ALWAYS_KEEP, ...identityKeys(entity)]);
  if (excluded?.length) {
    const drop = new Set(excluded.filter((k) => !pinned.has(k)));
    if (drop.size === 0) return rows;
    return rows.map((r) => {
      const out = {};
      for (const k of Object.keys(r)) if (!drop.has(k)) out[k] = r[k];
      return out;
    });
  }
  if (!columns || columns.length === 0) return rows;
  const keep = new Set([...columns, ...pinned]);
  return rows.map((r) => {
    const out = {};
    for (const k of Object.keys(r)) if (keep.has(k)) out[k] = r[k];
    return out;
  });
}

/**
 * Keep only records (groups) whose top row matches the active row filters.
 * Matching is the export page's advanced-filter semantics (shared module):
 * case-insensitive, comma-separated "any of" value lists, GID tail matching.
 */
function applyRowFilters(rows, filters) {
  const mapped = (filters ?? []).map((f) =>
    f && LEGACY_FILTER_OPS[f.operator] ? { ...f, operator: LEGACY_FILTER_OPS[f.operator] } : f);
  const active = activeAdvancedFilters(mapped);
  if (!active.length) return rows;
  return groupRecords(rows).filter((g) => matchesAdvancedFilters(topRow(g), active)).flat();
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
export function analyzeWorkbook({ fileBuffer, format, entity = "auto", plan = null, filename = null, blockedEntities = [] }) {
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
        filters: p?.filters ?? null,
        selectedColumns: p?.columns ?? null,
        excludedColumns: p?.excludeColumns ?? null,
        blockedEntities,
      });
    });

  // `importable` counts valid ROWS (what the preview shows as "N rows ready");
  // `importableRecords` counts valid RECORDS — the writers' progress unit.
  const totals = { parsed: 0, valid: 0, invalid: 0, create: 0, update: 0, delete: 0, skip: 0, importable: 0, importableRecords: 0 };
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
      totals.importableRecords += s.validRecords ?? s.valid;
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
export async function applyImport({ validRows, entity, admin, onProgress, options = {} }) {
  const writer = WRITERS[entity];
  if (!writer) throw new Error(`No writer for entity: ${entity}`);

  // Import mode filters records before writing (update-only / create-only /
  // no-delete), and dry-run reports what WOULD happen without writing.
  const mode = options.mode || "normal";
  const rows = mode === "normal" ? validRows : filterRecordsByMode(validRows, entity, mode);

  if (mode === "dryRun") {
    const intent = summarizeIntent(rows, entity);
    return { created: intent.create, updated: intent.update, deleted: intent.delete, errors: [], dryRun: true };
  }

  if (rows.length === 0) return { created: 0, updated: 0, deleted: 0, errors: [] };
  // Writers get the full options object (behavior checkboxes like
  // createRedirects) alongside the progress callback.
  return writer(rows, admin, { onProgress, options });
}

// Identity keys that are also real data — kept even when force-creating, so
// the write attempts loudly fail on true duplicates (email, redirect path)
// instead of silently dropping the value.
const FORCE_CREATE_KEEPS = new Set(["email", "path"]);

/** Keep only the records an import mode should write; returns flat rows. */
function filterRecordsByMode(validRows, entity, mode) {
  // "Import everything even if exists": drop deletes, then strip the
  // identifiers from every surviving record so it takes the create path —
  // the writers can't match an existing item they can't identify.
  if (mode === "forceCreate") {
    const strip = identityKeys(entity).filter((k) => !FORCE_CREATE_KEEPS.has(k));
    return groupRecords(validRows)
      .filter((g) => classifyRecord(topRow(g), entity) !== "delete")
      .flat()
      .map((r) => {
        const out = { ...r };
        for (const k of strip) delete out[k];
        // UPDATE/REPLACE/MERGE commands would still steer writers toward
        // matching — force them to NEW.
        if (String(out.command ?? "").trim()) out.command = "NEW";
        return out;
      });
  }
  if (mode !== "noDelete" && mode !== "createOnly" && mode !== "updateOnly") return validRows;
  const groups = groupRecords(validRows).filter((g) => {
    const cls = classifyRecord(topRow(g), entity);
    if (mode === "noDelete") return cls !== "delete";
    if (mode === "createOnly") return cls === "create";
    if (mode === "updateOnly") return cls === "update";
    return true;
  });
  return groups.flat();
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
export async function runImportForJob({ admin, shop, jobId, plan = null, options = {} }) {
  const [
    { getImportJob, markImportRunning, updateImportProgress, markImportComplete, markImportFailed },
    { downloadFromR2, putToR2, signDownloadUrl },
    { buildResultsWorkbook },
    { getAppSettings },
  ] = await Promise.all([
    import("../db/bulkImportJob.server.js"),
    import("../export/delivery/r2.js"),
    import("./results.js"),
    import("../db/appSettings.server.js"),
  ]);

  const job = await getImportJob(jobId);
  if (!job) throw new Error(`Import job not found: ${jobId}`);

  try {
    const { blockedEntities } = await getAppSettings(shop);
    const fileBuffer = await downloadFromR2(job.sourceR2Key);
    const { sheets } = analyzeWorkbook({ fileBuffer, format: job.format, plan, filename: job.filename, blockedEntities });

    // Progress is counted in records across the sheets we can actually write.
    const progressTotal = sheets
      .filter((s) => s.ok)
      .reduce((n, s) => n + groupRecords(s.validRows).length, 0);
    await markImportRunning({ id: jobId, progressTotal });

    let done = 0;
    // Writers report each record as it lands, so the bar advances smoothly.
    // Persist at most every 150ms — enough for the page's 1s poll, without one
    // database write per row on a 100k-row import.
    let lastPersist = 0;
    const persistProgress = () => {
      const now = Date.now();
      if (now - lastPersist < 150) return;
      lastPersist = now;
      updateImportProgress({ id: jobId, progressCurrent: done }).catch(() => {});
    };
    const totals = { created: 0, updated: 0, deleted: 0, failed: 0 };
    const sheetResults = [];

    for (const s of sheets) {
      // Bail between sheets when the user pressed Cancel. Rows already
      // written stay written (imports aren't transactional across sheets).
      const { isImportCancelRequested, markImportCancelled } = await import("../db/bulkImportJob.server.js");
      if (await isImportCancelRequested(jobId)) {
        await markImportCancelled({ id: jobId });
        return;
      }
      if (!s.ok) { sheetResults.push(s); continue; }
      const res = await applyImport({
        validRows: s.validRows,
        entity: s.entity,
        admin,
        options,
        onProgress: (n) => {
          done += n;
          persistProgress();   // best-effort; the final count is set on completion
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