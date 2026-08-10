/**
 * import/zipImport.test.js
 *
 * A ZIP of CSVs (what the multi-entity csv export produces) imports as a
 * multi-sheet workbook: one named sheet per .csv entry, entities detected
 * from headers. Closes the round-trip for the zip export format.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { zipParts } from "../export/formats/zip.js";
import { toCSV } from "../export/formats/csv.js";
import { parseSheets, analyzeWorkbook } from "./importJob.js";

const productRows = [{ handle: "widget-1", title: "Widget", vendor: "Acme", status: "ACTIVE" }];
const customerRows = [{ email: "a@b.com", first_name: "Ana", last_name: "Tester" }];

function exportZip() {
  return zipParts([
    { name: "products.csv", data: toCSV(productRows, Object.keys(productRows[0])) },
    { name: "customers.csv", data: toCSV(customerRows, Object.keys(customerRows[0])) },
  ]);
}

test("a zip of csvs parses into one named sheet per entry", () => {
  const sheets = parseSheets(exportZip(), "zip");
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map((s) => s.name), ["products", "customers"]);
  assert.equal(sheets[0].rows.length, 1);
  assert.equal(sheets[1].rows.length, 1);
  assert.ok(Object.values(sheets[1].rows[0]).includes("a@b.com"), "customer row survives the zip");
});

test("analyzeWorkbook detects each csv entry's entity from its headers", () => {
  const { sheets } = analyzeWorkbook({ fileBuffer: exportZip(), format: "zip", filename: "export.zip" });
  const entities = sheets.map((s) => s.entity);
  assert.ok(entities.includes("products"), `products detected, got ${entities}`);
  assert.ok(entities.includes("customers"), `customers detected, got ${entities}`);
});

test("a zip with no csv entries is rejected with a clear error", () => {
  const zip = zipParts([{ name: "readme.txt", data: Buffer.from("hi") }]);
  assert.throws(() => parseSheets(zip, "zip"), /no \.csv or \.xlsx files/i);
});

test("nested folder entries keep only their base name", () => {
  const zip = zipParts([{ name: "export/products.csv", data: toCSV(productRows, Object.keys(productRows[0])) }]);
  const sheets = parseSheets(zip, "zip");
  assert.equal(sheets[0].name, "products");
});

test("xlsx entries inside a zip contribute their sheets (bundled folder import)", async () => {
  const { toExcelWorkbook } = await import("../export/formats/excel.js");
  const wb = toExcelWorkbook([{ name: "Customers", rows: customerRows, columns: Object.keys(customerRows[0]) }]);
  const zip = zipParts([
    { name: "products.csv", data: toCSV(productRows, Object.keys(productRows[0])) },
    { name: "customers.xlsx", data: wb },
  ]);
  const sheets = parseSheets(zip, "zip");
  assert.deepEqual(sheets.map((s) => s.name).sort(), ["Customers", "products"]);
  assert.equal(sheets.find((s) => s.name === "Customers").rows.length, 1);
});
