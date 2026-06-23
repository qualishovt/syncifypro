/**
 * export/formats/columns.js
 *
 * Shared column resolution for all format adapters. When the caller
 * doesn't pass an explicit column list, derive it from the data by
 * scanning every row — not just the first — so keys that appear only
 * on some rows (e.g. an order with no line items) aren't dropped.
 */

import { FIELD_LABELS } from "../fieldLists.js";

/**
 * Human-readable header for a column key — the same label shown in the
 * export UI's column selector (FIELD_LABELS), falling back to the raw
 * snake_case key when no label is defined. This keeps the file headers
 * identical to what the user ticked when selecting columns.
 *
 * Values are still keyed by the raw snake_case key — only the emitted
 * header/element/property name is humanized.
 *
 * @param {string} key
 * @returns {string}
 */
export function columnHeader(key) {
  return FIELD_LABELS[key] ?? key;
}

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
