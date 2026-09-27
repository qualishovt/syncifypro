import { test } from "node:test";
import assert from "node:assert/strict";
import { stableJson } from "./stableJson.js";

test("key order does not count as a change", () => {
  const a = { format: "csv", options: { zip: true, skipEmpty: false } };
  const b = { options: { skipEmpty: false, zip: true }, format: "csv" };
  assert.equal(stableJson(a), stableJson(b));
});

test("array order DOES count — columns and sort rules are ordered", () => {
  assert.notEqual(
    stableJson({ fields: ["title", "sku"] }),
    stableJson({ fields: ["sku", "title"] }),
  );
});

test("an absent value and an undefined one compare equal", () => {
  assert.equal(stableJson({ a: 1, b: undefined }), stableJson({ a: 1, b: null }));
});

test("a real edit is seen", () => {
  const before = stableJson({ spec: [{ entity: "products", filters: {} }] });
  const after = stableJson({ spec: [{ entity: "products", filters: { status: "active" } }] });
  assert.notEqual(before, after);
});

test("changing a setting back leaves the same signature", () => {
  const start = { format: "csv", options: { zip: false } };
  const touched = { format: "excel", options: { zip: false } };
  const restored = { options: { zip: false }, format: "csv" };
  assert.notEqual(stableJson(start), stableJson(touched));
  assert.equal(stableJson(start), stableJson(restored));
});

test("nested objects are sorted at every level", () => {
  const a = { spec: [{ filters: { b: 2, a: 1 }, entity: "orders" }] };
  const b = { spec: [{ entity: "orders", filters: { a: 1, b: 2 } }] };
  assert.equal(stableJson(a), stableJson(b));
});
