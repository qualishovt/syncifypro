/**
 * import/importJob.js
 *
 * Orchestrator: parse → validate → write.
 * Each stage is independent — swap any one without touching the others.
 */

import { parseCSV } from "./parsers/csv.js";
import { validateProductRows } from "./validators/products.js";
import { validateOrderRows } from "./validators/orders.js";
import { upsertProducts } from "./writers/upsertProducts.js";
import { upsertOrders } from "./writers/upsertOrders.js";

const PARSERS = {
  csv: parseCSV,
  // excel: parseExcel,
  // xml:   parseXML,
  // json:  parseJSON,
};

const VALIDATORS = {
  products: validateProductRows,
  orders:   validateOrderRows,
  // collections: validateCollectionRows,
};

const WRITERS = {
  products: upsertProducts,
  orders:   upsertOrders,
};

/** Number of sample rows the analyze step returns for UI preview. */
const SAMPLE_ROW_COUNT = 5;

/**
 * Analyze an uploaded file: parse + validate only. No writes.
 * Used by the import UI's two-step flow to preview what will happen
 * before the merchant confirms.
 *
 * @param {object} options
 * @param {Buffer} options.fileBuffer
 * @param {string} options.format - "csv" | "excel" | "xml" | "json"
 * @param {string} options.entity
 * @returns {{
 *   parsed: number,
 *   valid: number,
 *   invalid: number,
 *   validationErrors: object[],
 *   detectedColumns: string[],
 *   sampleRows: object[],
 *   validRows: object[],
 * }}
 */
export function analyzeImport({ fileBuffer, format, entity }) {
  const parser    = PARSERS[format];
  const validator = VALIDATORS[entity];

  if (!parser)    throw new Error(`Unsupported format: ${format}`);
  if (!validator) throw new Error(`Unsupported entity: ${entity}`);

  const rows = parser(fileBuffer);
  const { valid, errors: validationErrors } = validator(rows);

  return {
    parsed:  rows.length,
    valid:   valid.length,
    invalid: validationErrors.length,
    validationErrors,
    detectedColumns: rows.length > 0 ? Object.keys(rows[0]) : [],
    sampleRows: rows.slice(0, SAMPLE_ROW_COUNT),
    validRows:  valid,
  };
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
export async function applyImport({ validRows, entity, admin }) {
  const writer = WRITERS[entity];
  if (!writer) throw new Error(`No writer for entity: ${entity}`);

  if (validRows.length === 0) return { created: 0, updated: 0, errors: [] };
  return writer(validRows, admin);
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