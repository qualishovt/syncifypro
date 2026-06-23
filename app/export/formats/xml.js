/**
 * export/formats/xml.js
 *
 * Serializes normalized flat rows to an XML buffer. Mirrors the flat
 * CSV shape: a <rows> root containing one <row> per record, with one
 * child element per column. Column names become element names, so the
 * output round-trips with the flat CSV/JSON importer.
 */

import { resolveColumns, columnHeader } from "./columns.js";

/**
 * Serialize rows to an XML Buffer.
 *
 * @param {object[]} rows      - normalized rows (any entity)
 * @param {string[]} [columns] - optional explicit column subset/order
 * @returns {Buffer}
 */
export function toXML(rows, columns) {
  const cols = resolveColumns(rows, columns);

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<rows>"];

  for (const row of rows) {
    lines.push("  <row>");
    for (const col of cols) {
      const tag = elementName(columnHeader(col));
      lines.push(`    <${tag}>${escapeXML(row[col] ?? "")}</${tag}>`);
    }
    lines.push("  </row>");
  }

  lines.push("</rows>");
  return Buffer.from(lines.join("\n"), "utf8");
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Escape the five predefined XML entities in text content. */
function escapeXML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Coerce a column key into a valid XML element name. Our column keys
 * are already snake_case identifiers, but guard against a leading
 * digit or stray character so we never emit malformed XML.
 */
function elementName(col) {
  let name = String(col).replace(/[^a-zA-Z0-9_.-]/g, "_");
  if (!/^[a-zA-Z_]/.test(name)) name = `_${name}`;
  return name;
}
