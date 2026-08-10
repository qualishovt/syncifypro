/**
 * Tests for import/detect.js and import/intent.js — the auto-detect + preview
 * intent layer that makes the import "just drop the file" like Matrixify.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { detectEntity } from "./detect.js";
import { summarizeIntent, classifyRecord } from "./intent.js";

test("detectEntity: products file from distinctive columns", () => {
  const headers = ["ID", "Command", "Handle", "Title", "Variant SKU", "Body HTML", "Vendor"];
  const d = detectEntity(headers);
  assert.equal(d.entity, "products");
  assert.equal(d.supported, true);
  assert.equal(d.confidence, "high");
});

test("detectEntity: redirects file isn't mistaken for products", () => {
  // "ID"/"Command" are shared, but "Path"/"Redirect to" are redirect-only.
  const headers = ["ID", "Command", "Path", "Redirect to"];
  const d = detectEntity(headers);
  assert.equal(d.entity, "redirects");
});

test("detectEntity: customers file", () => {
  const headers = ["ID", "Command", "Email", "First Name", "Last Name", "Tags"];
  const d = detectEntity(headers);
  assert.equal(d.entity, "customers");
});

test("detectEntity: only generic columns → no detection at all", () => {
  // ID/Command/Note appear on nearly every entity — matching ONLY those
  // identifies nothing (a lone "Note" column must not become gift cards).
  const d = detectEntity(["ID", "Command"]);
  assert.equal(d.entity, null);
  assert.equal(d.confidence, "none");
  assert.equal(detectEntity(["Note"]).entity, null);
});

test("detectEntity: empty header list → none", () => {
  const d = detectEntity([]);
  assert.equal(d.entity, null);
  assert.equal(d.confidence, "none");
});

test("summarizeIntent: MERGE with id = update, without id = create", () => {
  const rows = [
    { product_id: "gid://x/1", command: "", title: "Has id" },      // update
    { product_id: "", handle: "", command: "MERGE", title: "New" }, // create
  ];
  const s = summarizeIntent(rows, "products");
  assert.equal(s.records, 2);
  assert.equal(s.update, 1);
  assert.equal(s.create, 1);
});

test("summarizeIntent: NEW/DELETE/IGNORE commands", () => {
  const rows = [
    { product_id: "gid://x/1", command: "NEW" },     // create (forced)
    { product_id: "gid://x/2", command: "DELETE" },  // delete
    { product_id: "gid://x/3", command: "IGNORE" },  // skip
  ];
  const s = summarizeIntent(rows, "products");
  assert.equal(s.create, 1);
  assert.equal(s.delete, 1);
  assert.equal(s.skip, 1);
});

test("summarizeIntent: unknown command is recorded and skipped", () => {
  const rows = [{ product_id: "gid://x/1", command: "FROB" }];
  const s = summarizeIntent(rows, "products");
  assert.equal(s.skip, 1);
  assert.deepEqual(s.unknownCommands, ["FROB"]);
});

test("summarizeIntent: exploded rows count as one record", () => {
  const rows = [
    { product_id: "gid://x/1", command: "MERGE", top_row: "true", title: "P" },
    { product_id: "", command: "", top_row: "", variant_sku: "V1" },
    { product_id: "", command: "", top_row: "", variant_sku: "V2" },
  ];
  const s = summarizeIntent(rows, "products");
  assert.equal(s.records, 1);
  assert.equal(s.update, 1);
});

// ─── classifyRecord (drives import modes) ──────────────────────────────────────

test("classifyRecord: MERGE with identity → update, without → create", () => {
  assert.equal(classifyRecord({ command: "", product_id: "gid://x/1" }, "products"), "update");
  assert.equal(classifyRecord({ command: "", product_id: "", handle: "" }, "products"), "create");
});

test("classifyRecord: explicit commands", () => {
  assert.equal(classifyRecord({ command: "NEW", product_id: "1" }, "products"), "create");
  assert.equal(classifyRecord({ command: "DELETE", product_id: "1" }, "products"), "delete");
  assert.equal(classifyRecord({ command: "IGNORE" }, "products"), "skip");
  assert.equal(classifyRecord({ command: "UPDATE", product_id: "1" }, "products"), "update");
  assert.equal(classifyRecord({ command: "REPLACE", handle: "h" }, "products"), "update");
});

test("classifyRecord: unknown command → skip", () => {
  assert.equal(classifyRecord({ command: "FROB" }, "products"), "skip");
});

test("classifyRecord: identity keys are per-entity", () => {
  assert.equal(classifyRecord({ command: "", email: "a@b.com" }, "customers"), "update");
  assert.equal(classifyRecord({ command: "", path: "/x" }, "redirects"), "update");
});
