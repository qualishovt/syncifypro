/**
 * import/parsers/xlsx.js
 *
 * Reads an .xlsx (Office Open XML) workbook into sheets — the inverse of
 * export/formats/excel.js and the piece that makes "drop one Excel file with a
 * Products sheet, a Customers sheet and an Orders sheet" work like Matrixify.
 *
 * An .xlsx is a ZIP of XML parts. With no spreadsheet library available we:
 *   1. Read the ZIP central directory → a { partName → Buffer } map (unzip.js).
 *   2. Parse xl/workbook.xml (+ rels) for sheet names and their part paths.
 *   3. Parse xl/sharedStrings.xml (real Excel/Matrixify files store text there;
 *      our own exporter uses inline strings, so both are supported).
 *   4. Parse each worksheet's rows/cells, using each cell's `r` reference
 *      ("B2") to place values in the right column even when cells are missing.
 *
 * Output shape matches the CSV parser: an array of row objects keyed by the
 * header row — but wrapped per sheet: [{ name, rows }, …].
 */

import { unzip } from "./unzip.js";

/** @typedef {{ name: string, rows: object[] }} Sheet */

/**
 * Parse an .xlsx buffer into sheets.
 *
 * @param {Buffer} buffer
 * @returns {Sheet[]}
 */
export function parseXLSX(buffer) {
  const parts = unzip(buffer);

  const workbookXml = textPart(parts, "xl/workbook.xml");
  if (!workbookXml) throw new Error("Not a valid .xlsx file (missing xl/workbook.xml).");

  const relsXml = textPart(parts, "xl/_rels/workbook.xml.rels") ?? "";
  const relMap = parseRels(relsXml); // rId → target (e.g. "worksheets/sheet1.xml")

  const sharedStrings = parseSharedStrings(
    textPart(parts, "xl/sharedStrings.xml") ?? "",
  );

  const sheetRefs = parseWorkbookSheets(workbookXml); // [{ name, rId }]

  const sheets = [];
  for (const ref of sheetRefs) {
    const target = relMap.get(ref.rId);
    if (!target) continue;
    const partPath = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target}`;
    const sheetXml = textPart(parts, partPath);
    if (!sheetXml) continue;

    const rows = parseWorksheet(sheetXml, sharedStrings);
    sheets.push({ name: ref.name, rows });
  }

  // Fallback: no workbook rels mapping resolved — read any sheetN.xml directly.
  if (sheets.length === 0) {
    const sheetParts = [...parts.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();
    for (const partPath of sheetParts) {
      const rows = parseWorksheet(textPart(parts, partPath), sharedStrings);
      sheets.push({ name: partPath.replace(/^.*sheet(\d+)\.xml$/, "Sheet$1"), rows });
    }
  }

  return sheets;
}

// ─── XML sub-parsers ─────────────────────────────────────────────────────────

function textPart(parts, name) {
  const buf = parts.get(name);
  return buf ? buf.toString("utf8") : null;
}

/** rels: <Relationship Id="rId1" Target="worksheets/sheet1.xml"/> → Map(rId→target). */
function parseRels(xml) {
  const map = new Map();
  const re = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml))) map.set(m[1], m[2]);
  // Attribute order isn't guaranteed; catch Target-before-Id too.
  const re2 = /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"[^>]*\/?>/g;
  while ((m = re2.exec(xml))) if (!map.has(m[2])) map.set(m[2], m[1]);
  return map;
}

/** workbook: <sheet name="Products" sheetId="1" r:id="rId1"/> → [{name, rId}]. */
function parseWorkbookSheets(xml) {
  const sheets = [];
  const re = /<sheet\b[^>]*\/?>/g;
  let tag;
  while ((tag = re.exec(xml))) {
    const s = tag[0];
    const name = attr(s, "name");
    const rId = attr(s, "r:id") ?? attr(s, "id");
    if (rId) sheets.push({ name: unescapeXml(name ?? ""), rId });
  }
  return sheets;
}

/**
 * sharedStrings: <si><t>Value</t></si> or rich <si><r><t>a</t></r><r><t>b</t></r></si>.
 * Returns an array indexed by shared-string index.
 */
function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    // Concatenate every <t>…</t> inside the <si> (handles rich-text runs).
    const inner = m[1];
    const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    let value = "";
    let matched = false;
    while ((t = tre.exec(inner))) { value += t[1]; matched = true; }
    out.push(matched ? unescapeXml(value) : "");
  }
  return out;
}

/**
 * Parse one worksheet's <sheetData> into row objects. The first row is the
 * header; subsequent rows become objects keyed by header. Cell column is taken
 * from its `r` ref (e.g. "C5" → column C) so gaps don't shift values.
 *
 * @param {string} xml
 * @param {string[]} sharedStrings
 * @returns {object[]}
 */
function parseWorksheet(xml, sharedStrings) {
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const parsedRows = []; // [{ colIndex: value }]
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    parsedRows.push(parseRowCells(rowMatch[1], sharedStrings));
  }
  // Some writers emit self-closing empty rows (<row .../>); those hold no data.
  if (parsedRows.length === 0) return [];

  const headerCells = parsedRows[0];
  const maxCol = parsedRows.reduce(
    (max, cells) => Math.max(max, ...Object.keys(cells).map(Number), -1),
    -1,
  );

  const headers = [];
  for (let c = 0; c <= maxCol; c++) headers[c] = (headerCells[c] ?? "").trim();

  const rows = [];
  for (let r = 1; r < parsedRows.length; r++) {
    const cells = parsedRows[r];
    // Skip fully-blank rows (Excel often trails empty rows).
    if (Object.values(cells).every((v) => String(v).trim() === "")) continue;
    const row = {};
    for (let c = 0; c <= maxCol; c++) {
      const header = headers[c];
      if (!header) continue; // unnamed column → ignore
      row[header] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/** Parse the cells inside one <row>, keyed by 0-based column index. */
function parseRowCells(rowInner, sharedStrings) {
  const cells = {};
  const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  let autoCol = 0;
  while ((m = cellRe.exec(rowInner))) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const ref = attr(`<c ${attrs}>`, "r");
    const colIndex = ref ? colIndexFromRef(ref) : autoCol;
    autoCol = colIndex + 1;

    const type = attr(`<c ${attrs}>`, "t");
    cells[colIndex] = cellValue(type, body, sharedStrings);
  }
  return cells;
}

/** Resolve a cell's text value given its type and inner XML. */
function cellValue(type, body, sharedStrings) {
  if (type === "s") {
    // Shared string: <v>index</v>
    const idx = Number(innerTag(body, "v"));
    return sharedStrings[idx] ?? "";
  }
  if (type === "inlineStr") {
    // Inline: <is><t>text</t></is> (may have rich-text runs)
    const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    let value = "";
    while ((t = tre.exec(body))) value += t[1];
    return unescapeXml(value);
  }
  if (type === "str") {
    // Formula string result: <v>text</v>
    return unescapeXml(innerTag(body, "v"));
  }
  if (type === "b") {
    return innerTag(body, "v") === "1" ? "TRUE" : "FALSE";
  }
  // Number / date / general: <v>number</v>
  return unescapeXml(innerTag(body, "v"));
}

// ─── tiny helpers ────────────────────────────────────────────────────────────

function innerTag(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : "";
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name.replace(":", "\\:")}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/** "AB12" → 27 (0-based column index of column AB). */
function colIndexFromRef(ref) {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // must be last
}
