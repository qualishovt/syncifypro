/**
 * import/validators/redirects.js
 *
 * Validates parsed URL-redirect rows. Returns { valid, errors }.
 * Supports the `command` column: DELETE needs redirect_id; NEW/UPDATE/MERGE
 * need path + target (UPDATE/MERGE use redirect_id if present, else match path).
 */

export function validateRedirectRows(rows) {
  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 header, +1 to 1-index
    const rowErrors = [];
    const command = (row.command || "").trim().toUpperCase() || "UPDATE";

    if (command === "DELETE") {
      if (!row.redirect_id?.trim()) {
        rowErrors.push({ row: rowNum, field: "redirect_id", message: '"redirect_id" is required to DELETE a redirect' });
      }
    } else if (command !== "IGNORE") {
      if (!row.path?.trim()) {
        rowErrors.push({ row: rowNum, field: "path", message: '"path" is required' });
      }
      if (!row.target?.trim()) {
        rowErrors.push({ row: rowNum, field: "target", message: '"target" is required' });
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
    } else if (command !== "IGNORE") {
      valid.push({
        command,
        redirect_id: row.redirect_id?.trim() || "",
        path:        row.path?.trim() || "",
        target:      row.target?.trim() || "",
      });
    }
  });

  return { valid, errors };
}
