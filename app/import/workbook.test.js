/**
 * Tests for analyzeWorkbook — the multi-sheet analyze that routes each sheet to
 * an entity (by sheet name, then columns), validates it, and sums intent totals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeWorkbook } from "./importJob.js";
import { toExcelWorkbook } from "../export/formats/excel.js";

function workbook() {
  return toExcelWorkbook([
    { name: "Products", rows: [
        { product_id: "gid://x/1", command: "", handle: "shirt", title: "Blue Shirt", vendor: "Acme" },
        { product_id: "", command: "NEW", handle: "", title: "New Hat", vendor: "Acme" },
    ], columns: ["product_id", "command", "handle", "title", "vendor"] },
    { name: "Customers", rows: [
        { customer_id: "gid://c/1", command: "", email: "a@b.com", first_name: "Zoe" },
        { customer_id: "gid://c/2", command: "DELETE", email: "z@b.com" },
    ], columns: ["customer_id", "command", "email", "first_name"] },
    { name: "Instructions", rows: [{ Note: "read me" }] },
  ]);
}

test("routes each sheet by name and validates independently", () => {
  const { sheets } = analyzeWorkbook({ fileBuffer: workbook(), format: "xlsx" });

  const products = sheets.find((s) => s.name === "Products");
  const customers = sheets.find((s) => s.name === "Customers");
  assert.equal(products.ok, true);
  assert.equal(products.entity, "products");
  assert.equal(products.detection.via, "sheet name");
  assert.equal(customers.entity, "customers");
});

test("intent is per-record, per sheet", () => {
  const { sheets } = analyzeWorkbook({ fileBuffer: workbook(), format: "xlsx" });
  const products = sheets.find((s) => s.name === "Products");
  const customers = sheets.find((s) => s.name === "Customers");
  assert.equal(products.intent.create, 1); // NEW
  assert.equal(products.intent.update, 1); // has id, MERGE
  assert.equal(customers.intent.delete, 1);
  assert.equal(customers.intent.update, 1);
});

test("unsupported/unrecognized sheet is marked not-ok, not thrown", () => {
  const { sheets } = analyzeWorkbook({ fileBuffer: workbook(), format: "xlsx" });
  const junk = sheets.find((s) => s.name === "Instructions");
  assert.equal(junk.ok, false);
  assert.ok(junk.reason);
});

test("totals sum importable records across ok sheets only", () => {
  const { totals } = analyzeWorkbook({ fileBuffer: workbook(), format: "xlsx" });
  assert.equal(totals.create, 1);
  assert.equal(totals.update, 2);
  assert.equal(totals.delete, 1);
  assert.equal(totals.importable, 4); // 2 products + 2 customers valid
});

test("sheet exposes columns with unknown ones flagged", () => {
  const csv = ["ID,Command,Title,Frobnicate", "gid://x/1,,Blue,zzz"].join("\n");
  const { sheets } = analyzeWorkbook({ fileBuffer: Buffer.from(csv), format: "csv" });
  const cols = sheets[0].columns;
  assert.equal(cols.find((c) => c.name === "Title").known, true);
  assert.equal(cols.find((c) => c.name === "Frobnicate").known, false);
  assert.deepEqual(sheets[0].unknownColumns, ["Frobnicate"]);
});

test("plan overrides entity per sheet and can ignore a sheet", () => {
  const wb = workbook();
  // Force the Products sheet (index 0) to be ignored, keep Customers (index 1).
  const plan = [{ entity: "ignore", include: false }, { entity: "auto", include: true }, { entity: "auto", include: true }];
  const { sheets, totals } = analyzeWorkbook({ fileBuffer: wb, format: "xlsx", plan });
  const products = sheets[0];
  assert.equal(products.ok, false);
  assert.equal(products.included, false);
  // Only the customers sheet counts toward importable now.
  assert.equal(totals.importable, 2);
  assert.equal(totals.create, 0); // products' NEW no longer counted
});

test("plan can force an entity that overrides name/column detection", () => {
  // A sheet whose columns look like products, forced to redirects, becomes invalid
  // rather than silently importing as products.
  const csv = ["ID,Command,Path,Redirect to", "1,,/old,/new"].join("\n");
  const forced = analyzeWorkbook({ fileBuffer: Buffer.from(csv), format: "csv", plan: [{ entity: "redirects", include: true }] });
  assert.equal(forced.sheets[0].entity, "redirects");
});

test("a CSV is routed by its file name when columns are ambiguous", () => {
  // Bare "ID, Handle" matches several entities (incl. Metaobjects); the file
  // name "Products.csv" resolves it to Products, the way Matrixify does.
  const csv = ["ID,Handle", "7253296185519,jseh test"].join("\n");
  const { sheets, totals } = analyzeWorkbook({ fileBuffer: Buffer.from(csv), format: "csv", filename: "Products.csv" });
  assert.equal(sheets[0].entity, "products");
  assert.equal(sheets[0].ok, true);
  assert.equal(sheets[0].detection.via, "sheet name");
  assert.equal(totals.importable, 1);
});

test("a plain CSV is analyzed as a single unnamed sheet", () => {
  const csv = ["ID,Command,Handle,Title,Variant SKU", "gid://x/1,,shirt,Blue,SKU1"].join("\n");
  const { sheets, totals } = analyzeWorkbook({ fileBuffer: Buffer.from(csv), format: "csv" });
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].entity, "products");
  assert.equal(sheets[0].detection.via, "columns");
  assert.equal(totals.importable, 1);
});
