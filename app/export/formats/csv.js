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
 * @param {object[]} rows      - normalized rows (any entity)
 * @param {string[]} [columns] - optional explicit column order
 * @returns {Buffer}
 */
export function toCSV(rows, columns) {
  // Derive columns from the data when not explicitly provided.
  // Scan all rows (not just the first) so we don't miss keys that
  // only appear on some rows — e.g. an order with no line items.
  let cols = columns;
  if (!cols) {
    const keySet = new Set();
    for (const row of rows) {
      for (const key of Object.keys(row)) keySet.add(key);
    }
    cols = [...keySet];
  }

  const lines = [cols.join(",")];

  for (const row of rows) {
    const values = cols.map((col) => escapeCSV(row[col] ?? ""));
    lines.push(values.join(","));
  }

  return Buffer.from(lines.join("\r\n"), "utf8");
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * RFC 4180-compliant CSV cell escaping.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
function escapeCSV(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}