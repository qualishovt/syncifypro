/**
 * Column widths in the generated .xlsx. Excel opens a sheet at whatever width
 * the file states, so "fit to contents" has to be computed here — these tests
 * read the <cols> element back out of the zipped worksheet.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

import { toExcel } from "./excel.js";

/** Pull sheet1.xml back out of the .xlsx (a zip of XML parts). */
function sheetXml(buffer) {
  // Walk the local file headers; each entry we write is deflated or stored.
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString();
    const dataAt = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(dataAt, dataAt + compressed);
    if (name.endsWith("sheet1.xml")) {
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset = dataAt + compressed;
  }
  throw new Error("sheet1.xml not found in the workbook");
}

/** Widths in column order, as numbers. */
function widths(xml) {
  return [...xml.matchAll(/<col min="(\d+)" max="\d+" width="(\d+)"/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => Number(m[2]));
}

test("a column is as wide as its widest value", () => {
  const xml = sheetXml(toExcel(
    [{ title: "A very long product title indeed", sku: "X1" }],
    ["title", "sku"],
    "products",
  ));
  const [title, sku] = widths(xml);
  assert.ok(title > sku, `title (${title}) should be wider than sku (${sku})`);
  assert.ok(title >= "A very long product title indeed".length, `got ${title}`);
});

test("a short column still opens at a readable minimum", () => {
  const xml = sheetXml(toExcel([{ id: "1" }], ["id"], "products"));
  assert.ok(widths(xml)[0] >= 9, `got ${widths(xml)[0]}`);
});

test("the header counts when it is the longest thing in the column", () => {
  const xml = sheetXml(toExcel([{ variant_inventory_qty: "3" }], ["variant_inventory_qty"], "products"));
  assert.ok(widths(xml)[0] >= 20, `got ${widths(xml)[0]}`);
});

test("one enormous value cannot make a wall of a column", () => {
  const xml = sheetXml(toExcel([{ body_html: "x".repeat(5000) }], ["body_html"], "products"));
  assert.equal(widths(xml)[0], 60);
});

test("a multi-line value is measured by its longest LINE", () => {
  const short = sheetXml(toExcel([{ body_html: "one\ntwo\nthree" }], ["body_html"], "products"));
  const long = sheetXml(toExcel([{ body_html: "a".repeat(40) }], ["body_html"], "products"));
  assert.ok(widths(short)[0] < widths(long)[0], `${widths(short)[0]} vs ${widths(long)[0]}`);
});

test("every column gets a width, in order", () => {
  const cols = ["handle", "title", "vendor", "tags"];
  const xml = sheetXml(toExcel([{ handle: "h", title: "t", vendor: "v", tags: "a,b" }], cols, "products"));
  assert.equal(widths(xml).length, cols.length);
});
