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

/**
 * Run a full import job.
 *
 * @param {object} options
 * @param {Buffer}  options.fileBuffer  - raw uploaded file
 * @param {string}  options.format      - "csv" | "excel" | "xml" | "json"
 * @param {string}  options.entity      - "products" | "orders" | …
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} options.admin
 *
 * @returns {Promise<{
 *   parsed:  number,
 *   valid:   number,
 *   invalid: number,
 *   created: number,
 *   updated: number,
 *   validationErrors: object[],
 *   writeErrors:      object[],
 * }>}
 */
export async function runImportJob({ fileBuffer, format, entity, admin }) {
  const parser    = PARSERS[format];
  const validator = VALIDATORS[entity];
  const writer    = WRITERS[entity];

  if (!parser)    throw new Error(`Unsupported format: ${format}`);
  if (!validator) throw new Error(`Unsupported entity: ${entity}`);
  if (!writer)    throw new Error(`No writer for entity: ${entity}`);

  // 1. Parse
  const rows = parser(fileBuffer);

  // 2. Validate
  const { valid, errors: validationErrors } = validator(rows);

  // 3. Write (only valid rows)
  const { created, updated, errors: writeErrors } = valid.length > 0
    ? await writer(valid, admin)
    : { created: 0, updated: 0, errors: [] };

  return {
    parsed:  rows.length,
    valid:   valid.length,
    invalid: validationErrors.length,
    created,
    updated,
    validationErrors,
    writeErrors,
  };
}