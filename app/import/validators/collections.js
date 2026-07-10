/**
 * import/validators/collections.js
 *
 * Validates parsed collection rows (one row per collection — no multi-row
 * assembly). Command drives the requirements:
 *   - DELETE needs a collection_id or handle.
 *   - Create/update needs a title (to create) or an ID/handle (to update).
 * Valid rows pass through UNCHANGED — the collection input builder coerces.
 */

export function validateCollectionRows(rows) {
  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 header, +1 to 1-index
    const e = [];
    const command = (row.command || "").trim().toUpperCase() || "MERGE";
    const hasIdentity = Boolean(str(row.collection_id) || str(row.handle));

    if (command === "DELETE") {
      if (!hasIdentity) e.push({ row: rowNum, field: "collection_id", message: "DELETE needs a collection ID or handle" });
    } else if (command !== "IGNORE") {
      if (!str(row.title) && !hasIdentity) {
        e.push({ row: rowNum, field: "title", message: "Collection needs a title, or an ID/handle to update" });
      }
    }

    if (e.length) errors.push(...e);
    else if (command !== "IGNORE") valid.push(row);
  });

  return { valid, errors };
}

function str(v) {
  return String(v ?? "").trim();
}
