/**
 * export/formats/json.js
 *
 * Serializes normalized flat rows to a JSON array buffer. Same flat
 * shape as the CSV export (one object per row, keys = column names),
 * so a JSON export round-trips through the same importer as the CSV.
 */

import { resolveColumns } from "./columns.js";

/**
 * Serialize rows to a pretty-printed JSON Buffer.
 *
 * @param {object[]} rows      - normalized rows (any entity)
 * @param {string[]} [columns] - optional explicit column subset/order
 * @returns {Buffer}
 */
export function toJSON(rows, columns) {
  const cols = resolveColumns(rows, columns);

  const projected = rows.map((row) => {
    const obj = {};
    for (const col of cols) obj[col] = row[col] ?? "";
    return obj;
  });

  return Buffer.from(JSON.stringify(projected, null, 2), "utf8");
}
