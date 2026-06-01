/**
 * export/formats/columns.js
 *
 * Shared column resolution for all format adapters. When the caller
 * doesn't pass an explicit column list, derive it from the data by
 * scanning every row — not just the first — so keys that appear only
 * on some rows (e.g. an order with no line items) aren't dropped.
 */

/**
 * @param {object[]} rows
 * @param {string[]} [columns] - explicit column order; returned as-is when given
 * @returns {string[]}
 */
export function resolveColumns(rows, columns) {
  if (columns) return columns;

  const keySet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) keySet.add(key);
  }
  return [...keySet];
}
