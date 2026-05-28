/**
 * import/parsers/csv.js
 *
 * Parses a CSV Buffer (or string) into an array of plain objects
 * keyed by the header row. Handles quoted fields and embedded commas.
 *
 * For files over ~100k rows, swap this out for fast-csv:
 *   import { parse } from "fast-csv";
 *   and pipe the buffer through a stream.
 */

/**
 * Parse a CSV buffer into row objects.
 *
 * @param {Buffer|string} input
 * @returns {object[]}
 */
export function parseCSV(input) {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;

  // Normalize line endings
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header.trim()] = values[idx]?.trim() ?? "";
    });
    rows.push(row);
  }

  return rows;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Split a single CSV line respecting RFC 4180 quoting rules.
 * Handles: "hello, world", "she said ""hi""", plain values.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Peek ahead — doubled quote is an escaped quote
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  return fields;
}