/**
 * utils/fileStamp.js
 *
 * The one timestamp format for generated file names, app-wide:
 * "YYYY-MM-DD-HHMMSS" (Matrixify-style — dashes in the date part only, the
 * time part run together). Used for export files, staged imports, results
 * workbooks and migration files so they all sort and read the same way.
 *
 * @param {Date} [now]
 * @returns {string} e.g. "2026-08-16-155107"
 */
export function fileStamp(now = new Date()) {
  return now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
}
