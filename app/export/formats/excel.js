/**
 * export/formats/excel.js
 *
 * Builds .xlsx (Office Open XML) workbooks with no external dependencies.
 * An .xlsx is a ZIP of XML parts; we assemble the minimal set of parts
 * and zip them with the shared ZIP writer.
 *
 * Two entry points:
 *   - toExcel(rows, columns)   — single-sheet (used by direct adapters)
 *   - toExcelWorkbook(sheets)  — multi-sheet (used by the multi-entity bundle)
 *
 * All cells are written as inline strings (t="inlineStr"). That keeps
 * the writer simple and makes exports round-trip cleanly through the
 * flat CSV/JSON importer — every value comes back as text, same as CSV.
 *
 * Used by the *direct* export path only. The streaming bulk worker
 * handles csv/json/xml; Excel is built fully in memory.
 */

import { resolveColumns, columnHeader } from "./columns.js";
import { zipParts } from "./zip.js";

/** @typedef {{ name: string, rows: object[], columns?: string[] }} Sheet */

/**
 * Build a multi-sheet workbook.
 * Sheet names are sanitised to Excel's rules (≤31 chars, no /\?*[]:).
 *
 * @param {Sheet[]} sheets
 * @returns {Buffer}
 */
export function toExcelWorkbook(sheets) {
  if (sheets.length === 0) throw new Error("Workbook needs at least one sheet");

  const sheetMetas = sheets.map((s, i) => {
    const cols = resolveColumns(s.rows, s.columns);
    return {
      index:    i + 1,
      name:     sheetName(s.name, i),
      partPath: `xl/worksheets/sheet${i + 1}.xml`,
      cols,
      rows:     s.rows,
    };
  });

  return zipParts([
    { name: "[Content_Types].xml",        data: Buffer.from(contentTypes(sheetMetas), "utf8") },
    { name: "_rels/.rels",                data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "xl/workbook.xml",            data: Buffer.from(workbookXml(sheetMetas), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels(sheetMetas), "utf8") },
    ...sheetMetas.map((m) => ({
      name: m.partPath,
      data: Buffer.from(buildSheetXml(m.rows, m.cols), "utf8"),
    })),
  ]);
}

/**
 * Build a single-sheet workbook from flat rows + optional column order.
 * @param {object[]} rows
 * @param {string[]} [columns]
 * @returns {Buffer}
 */
export function toExcel(rows, columns) {
  return toExcelWorkbook([{ name: "Export", rows, columns }]);
}

// ─── workbook-level XML ──────────────────────────────────────────────────────

function contentTypes(metas) {
  const overrides = metas
    .map((m) => `<Override PartName="/${m.partPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function workbookXml(metas) {
  const sheetTags = metas
    .map((m) => `<sheet name="${escapeXml(m.name)}" sheetId="${m.index}" r:id="rId${m.index}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetTags}</sheets>
</workbook>`;
}

function workbookRels(metas) {
  const rels = metas
    .map((m) => `<Relationship Id="rId${m.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${m.index}.xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
</Relationships>`;
}

// ─── worksheet XML ────────────────────────────────────────────────────────────

function buildSheetXml(rows, cols) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    "<sheetData>",
  ];

  parts.push(rowXml(1, cols.map(columnHeader)));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    parts.push(rowXml(i + 2, cols.map((c) => row[c] ?? "")));
  }

  parts.push("</sheetData>", "</worksheet>");
  return parts.join("");
}

function rowXml(rowNumber, values) {
  const cells = values.map((value, colIndex) => {
    const ref = `${colLetter(colIndex)}${rowNumber}`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  });
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

/** 0-based column index → spreadsheet column letter (0→A, 25→Z, 26→AA). */
function colLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Strip control chars XML 1.0 forbids (everything below 0x20 except \t \n \r).
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Excel sheet name rules: 1–31 chars; no \ / ? * [ ] :
 * Falls back to "Sheet{n}" on empty input.
 */
function sheetName(name, index) {
  let n = String(name ?? "").replace(/[\\/?*[\]:]/g, "_").trim();
  if (!n) n = `Sheet${index + 1}`;
  return n.length > 31 ? n.slice(0, 31) : n;
}
