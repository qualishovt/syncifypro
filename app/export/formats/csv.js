/**
 * export/formats/csv.js
 *
 * Converts an array of normalized flat row objects into a UTF-8
 * CSV buffer. No external libraries needed for export — for imports
 * of very large files (100k+ rows) consider adding fast-csv.
 *
 * Column order is defined here; it's the single source of truth
 * for the CSV shape your users will see and re-import.
 */

import { Buffer } from "node:buffer";
import { resolveColumns, columnHeader } from "./columns.js";

export const PRODUCT_CSV_COLUMNS = [
  "product_id",
  "title",
  "handle",
  "status",
  "vendor",
  "product_type",
  "tags",
  "description",
  "image_url",
  "variant_id",
  "variant_title",
  "sku",
  "price",
  "compare_at_price",
  "inventory_qty",
  "barcode",
  "weight",
  "weight_unit",
  "taxable",
  "created_at",
  "updated_at",
];

/**
 * Serialize rows to a CSV Buffer.
 *
 * If `columns` is omitted, the column list is derived from the keys
 * of the first row — so the same function works for products, orders,
 * or any other entity without hardcoding a column list per entity.
 *
 * `ctx.csv` (Advanced → CSV options, Matrixify parity) can override the
 * dialect: { delimiter, quote, newline, forceQuotes, bom, encoding }.
 * Defaults reproduce the historical output: comma, double quote, CRLF,
 * UTF-8, no BOM.
 *
 * @param {object[]} rows      - normalized rows (any entity)
 * @param {string[]} [columns] - optional explicit column order
 * @param {string}   [_entity] - unused (adapter signature)
 * @param {object}   [ctx]     - { csv?: dialect overrides }
 * @returns {Buffer}
 */
export function toCSV(rows, columns, _entity, ctx) {
  const opts = ctx?.csv ?? {};
  const delimiter = opts.delimiter || ",";
  const quote = opts.quote || '"';
  const newline = opts.newline || "\r\n";
  const force = Boolean(opts.forceQuotes);
  const cols = resolveColumns(rows, columns);
  const esc = (v) => escapeCSV(v, { delimiter, quote, force });

  const lines = [cols.map((c) => esc(columnHeader(c))).join(delimiter)];
  for (const row of rows) {
    lines.push(cols.map((col) => esc(row[col] ?? "")).join(delimiter));
  }

  const encoding = opts.encoding === "utf16le" ? "utf16le"
    : opts.encoding === "latin1" ? "latin1"
    : "utf8";
  const body = Buffer.from(lines.join(newline), encoding);
  if (!opts.bom) return body;
  // BOM helps Excel detect the encoding when double-clicking the file.
  const bom = encoding === "utf16le" ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, body]);
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * RFC 4180-style CSV cell escaping, generalized over the dialect.
 * Wraps in the quote symbol when forced or when the value contains the
 * delimiter, the quote symbol, or newlines.
 */
function escapeCSV(value, { delimiter = ",", quote = '"', force = false } = {}) {
  const str = String(value);
  if (force || str.includes(delimiter) || str.includes(quote) || /[\r\n]/.test(str)) {
    return `${quote}${str.split(quote).join(quote + quote)}${quote}`;
  }
  return str;
}