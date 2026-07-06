/**
 * Tests for results.js — the Matrixify-style import results workbook: the
 * imported rows echoed back with per-record "Import Result" + "Import Comment".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildResultsWorkbook } from "./results.js";
import { parseSheets } from "./importJob.js";

function sheetResult() {
  return [{
    name: "Products", entity: "products", ok: true,
    parsed: 2, valid: 2, invalid: 0,
    detectedColumns: ["ID", "Handle"],
    validRows: [
      { product_id: "111", handle: "shirt" },
      { product_id: "", handle: "hat", command: "NEW" },
    ],
    res: {
      created: 1, updated: 1, deleted: 0, skipped: 0, errors: [],
      results: [{ status: "updated", comment: "" }, { status: "failed", comment: "Handle taken" }],
    },
  }];
}

test("annotated sheet echoes rows with Import Result + Import Comment", () => {
  const sheets = parseSheets(buildResultsWorkbook(sheetResult()), "xlsx");
  assert.deepEqual(sheets.map((s) => s.name), ["Summary", "Products"]);

  const products = sheets.find((s) => s.name === "Products");
  assert.deepEqual(Object.keys(products.rows[0]), ["ID", "Handle", "Import Result", "Import Comment"]);
  assert.equal(products.rows[0]["Import Result"], "Updated");
  assert.equal(products.rows[0]["Import Comment"], "");
  assert.equal(products.rows[1]["Import Result"], "Failed");
  assert.equal(products.rows[1]["Import Comment"], "Handle taken");
});

test("Summary tallies each sheet's outcome", () => {
  const sheets = parseSheets(buildResultsWorkbook(sheetResult()), "xlsx");
  const summary = sheets.find((s) => s.name === "Summary").rows[0];
  assert.equal(summary.Created, "1");
  assert.equal(summary.Updated, "1");
  assert.equal(summary.Failed, "0"); // res.errors is empty (per-record comment carries the failure)
});
