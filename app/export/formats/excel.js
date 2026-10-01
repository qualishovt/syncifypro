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

import { Buffer } from "node:buffer";
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
    { name: "xl/styles.xml",              data: Buffer.from(STYLES_XML, "utf8") },
    ...sheetMetas.map((m) => ({
      name: m.partPath,
      data: Buffer.from(buildSheetXml(m.rows, m.cols), "utf8"),
    })),
  ]);
}

/** "product_media" → "Product media" — an entity slug as a sheet title. */
export function entitySheetName(entity) {
  const words = String(entity ?? "").split("_").filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Export";
}

/**
 * Build a single-sheet workbook from flat rows + optional column order.
 * The sheet is named after the exported entity ("Products"), not "Export".
 * @param {object[]} rows
 * @param {string[]} [columns]
 * @param {string} [entity]
 * @returns {Buffer}
 */
export function toExcel(rows, columns, entity) {
  return toExcelWorkbook([{ name: entitySheetName(entity), rows, columns }]);
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
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
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
  const stylesRel = `<Relationship Id="rId${metas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}${stylesRel}
</Relationships>`;
}

// Style 0 = default; style 1 = header (bold on a light-blue fill).
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

// ─── worksheet XML ────────────────────────────────────────────────────────────

function buildSheetXml(rows, cols) {
  // Freeze the header row plus the first two columns (Matrixify/Altera do the
  // same), so both stay put while scrolling. Narrow sheets freeze what exists.
  const xSplit = cols.length > 2 ? 2 : Math.max(cols.length - 1, 0);
  const pane = `<pane${xSplit > 0 ? ` xSplit="${xSplit}"` : ""} ySplit="1" topLeftCell="${colLetter(xSplit)}2" activePane="bottomRight" state="frozen"/>`;

  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`,
    colsXml(rows, cols),
    "<sheetData>",
  ];

  parts.push(rowXml(1, cols.map(columnHeader), HEADER_STYLE));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    parts.push(rowXml(i + 2, cols.map((c) => row[c] ?? "")));
  }

  parts.push("</sheetData>", "</worksheet>");
  return parts.join("");
}

// cellXfs index of the bold light-blue header style in STYLES_XML.
const HEADER_STYLE = 1;

// Column widths are in characters. Excel has no "fit to contents" instruction
// in the file itself — a sheet opens at whatever width the file states, and
// stating nothing means the 8.43-character default for every column, which is
// why exports opened with the text cut off.
const MIN_COL_WIDTH = 9;   // about the default: short columns still look normal
const MAX_COL_WIDTH = 60;  // a description column must not become a wall
const WIDTH_PADDING = 2;   // room for the header's filter arrow and a margin

/**
 * The longest line in a value. Measuring the whole string would let one
 * multi-line description (body_html) speak for a column that is otherwise
 * short — Excel wraps on newlines, so only the longest line needs to fit.
 */
function longestLine(value) {
  const s = String(value);
  if (!s.includes("\n")) return s.length;
  let longest = 0;
  for (const line of s.split("\n")) if (line.length > longest) longest = line.length;
  return longest;
}

/**
 * `<cols>` sized to each column's widest content (header included), clamped
 * so nothing opens hidden or absurd. Scanning stops for a column as soon as
 * it is already at the maximum, so a wide column costs nothing to measure.
 */
function colsXml(rows, cols) {
  if (cols.length === 0) return "";
  const entries = cols.map((c, i) => {
    let longest = longestLine(columnHeader(c) ?? "");
    for (const row of rows) {
      if (longest + WIDTH_PADDING >= MAX_COL_WIDTH) break;
      const v = row[c];
      if (v == null || v === "") continue;
      const len = longestLine(v);
      if (len > longest) longest = len;
    }
    const width = Math.min(Math.max(longest + WIDTH_PADDING, MIN_COL_WIDTH), MAX_COL_WIDTH);
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
  });
  return `<cols>${entries.join("")}</cols>`;
}

function rowXml(rowNumber, values, styleId) {
  const s = styleId ? ` s="${styleId}"` : "";
  const cells = values.map((value, colIndex) => {
    const ref = `${colLetter(colIndex)}${rowNumber}`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
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
