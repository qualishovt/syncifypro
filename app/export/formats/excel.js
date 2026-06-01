/**
 * export/formats/excel.js
 *
 * Serializes normalized flat rows into a .xlsx (Office Open XML)
 * workbook — with no external dependencies. An .xlsx file is just a
 * ZIP archive ("OPC package") of XML parts, so we assemble the minimal
 * set of parts and zip them with Node's built-in zlib.
 *
 * All cells are written as inline strings (t="inlineStr"). That keeps
 * the writer simple and makes the export round-trip cleanly through the
 * flat CSV/JSON importer — every value comes back as text, same as CSV.
 *
 * Used by the *direct* export path only. The streaming bulk worker
 * handles csv/json/xml; Excel is built fully in memory (see exportJob.js,
 * which keeps Excel on the direct path regardless of store size).
 */

import zlib from "zlib";
import { resolveColumns } from "./columns.js";

/**
 * @param {object[]} rows      - normalized rows (any entity)
 * @param {string[]} [columns] - optional explicit column subset/order
 * @returns {Buffer} a .xlsx file
 */
export function toExcel(rows, columns) {
  const cols = resolveColumns(rows, columns);

  const sheetXml = buildSheetXml(rows, cols);

  return zipParts([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels",         data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "xl/workbook.xml",     data: Buffer.from(WORKBOOK, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(WORKBOOK_RELS, "utf8") },
    { name: "xl/worksheets/sheet1.xml",   data: Buffer.from(sheetXml, "utf8") },
  ]);
}

// ─── worksheet XML ────────────────────────────────────────────────────────────

function buildSheetXml(rows, cols) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    "<sheetData>",
  ];

  // Header row
  parts.push(rowXml(1, cols.map((c) => c)));

  // Data rows
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
    // Strip control chars that are illegal in XML 1.0 (except tab/newline/cr)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// ─── static OPC parts ───────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Export" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

// ─── minimal ZIP writer (deflate) ─────────────────────────────────────────────

/**
 * Build a ZIP archive from a list of { name, data:Buffer } parts.
 * Uses deflate (method 8); no data descriptors, no Zip64.
 */
function zipParts(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf    = Buffer.from(file.name, "utf8");
    const crc        = crc32(file.data);
    const compressed = zlib.deflateRawSync(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(8, 8);          // compression: deflate
    local.writeUInt16LE(0, 10);         // mod time
    local.writeUInt16LE(0, 12);         // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);         // extra field length
    localChunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(8, 10);         // compression
    central.writeUInt16LE(0, 12);         // mod time
    central.writeUInt16LE(0, 14);         // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra field length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // relative offset of local header
    centralChunks.push(central, nameBuf);

    offset += 30 + nameBuf.length + compressed.length;
  }

  const centralDir     = Buffer.concat(centralChunks);
  const localData      = Buffer.concat(localChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);     // end of central dir signature
  eocd.writeUInt16LE(0, 4);              // disk number
  eocd.writeUInt16LE(0, 6);              // disk with central dir
  eocd.writeUInt16LE(files.length, 8);   // entries on this disk
  eocd.writeUInt16LE(files.length, 10);  // total entries
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20);             // comment length

  return Buffer.concat([localData, centralDir, eocd]);
}

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
