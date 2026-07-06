/**
 * Tests for the .xlsx reader (unzip + worksheet/shared-string parsing) and its
 * round-trip against the Excel writer — the parser half of multi-sheet import.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseXLSX } from "./xlsx.js";
import { zipParts } from "../../export/formats/zip.js";
import { toExcelWorkbook } from "../../export/formats/excel.js";

test("round-trip: writer (inline strings) → reader, multi-sheet + special chars", () => {
  const buf = toExcelWorkbook([
    { name: "Products", rows: [
        { product_id: "gid://x/1", title: "Blue, Shirt", vendor: "Acme <Co>" },
        { product_id: "gid://x/2", title: 'Hat "special"', vendor: "Béta" },
    ], columns: ["product_id", "title", "vendor"] },
    { name: "Customers", rows: [
        { customer_id: "gid://c/1", email: "a@b.com" },
    ], columns: ["customer_id", "email"] },
  ]);

  const sheets = parseXLSX(buf);
  assert.deepEqual(sheets.map((s) => s.name), ["Products", "Customers"]);
  // Headers come back humanized (as the reverse-map expects).
  assert.deepEqual(Object.keys(sheets[0].rows[0]), ["ID", "Title", "Vendor"]);
  assert.equal(sheets[0].rows[0].Title, "Blue, Shirt");
  assert.equal(sheets[0].rows[0].Vendor, "Acme <Co>");
  assert.equal(sheets[0].rows[1].Title, 'Hat "special"');
  assert.equal(sheets[0].rows[1].Vendor, "Béta");
  assert.equal(sheets[1].rows[0].Email, "a@b.com");
});

test("reads a real-Excel workbook that uses sharedStrings + missing cells", () => {
  // Build an .xlsx the way Excel does: text lives in sharedStrings, cells
  // reference it by index with t="s". Row 2 omits cell A2 (a gap).
  const shared = ["ID", "Title", "gid://x/9", "Hello &amp; &lt;World&gt;"];
  const sst =
    `<?xml version="1.0"?><sst count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t>${s}</t></si>`).join("") +
    `</sst>`;

  const sheetXml =
    `<?xml version="1.0"?><worksheet><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    // A2 missing → should come through as "" ; B2 present via shared string idx 3
    `<row r="2"><c r="B2" t="s"><v>3</v></c></row>` +
    // full row referencing shared strings + an inline numeric cell in a 3rd col
    `<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="s"><v>1</v></c></row>` +
    `</sheetData></worksheet>`;

  const buf = zipParts([
    { name: "[Content_Types].xml", data: Buffer.from(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/></Types>`, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(
        `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`, "utf8") },
    { name: "xl/sharedStrings.xml", data: Buffer.from(sst, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);

  const sheets = parseXLSX(buf);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, "Data");
  const rows = sheets[0].rows;
  assert.equal(rows.length, 2);
  // Row 2: A missing → "", B = unescaped shared string
  assert.equal(rows[0].ID, "");
  assert.equal(rows[0].Title, "Hello & <World>");
  // Row 3
  assert.equal(rows[1].ID, "gid://x/9");
  assert.equal(rows[1].Title, "Title");
});

test("throws on a non-xlsx buffer", () => {
  assert.throws(() => parseXLSX(Buffer.from("not a zip")), /ZIP|xlsx/i);
});
