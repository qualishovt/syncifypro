/**
 * Tests for export/advancedFilters.js — the post-fetch "advanced filter"
 * (column/operator/value) applied to exported rows per record.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyAdvancedFilters, matchesAdvancedFilters, activeAdvancedFilters } from "./advancedFilters.js";

// A product with two variants (one record = two rows; only the top row carries
// the product-level fields), plus a second single-variant product.
function productRows() {
  return [
    { product_id: "gid://shopify/Product/8590259323055", title: "Blue Shirt", vendor: "Acme", top_row: "TRUE", sku: "BS-1" },
    { product_id: "", title: "", vendor: "", top_row: "", sku: "BS-2" },
    { product_id: "gid://shopify/Product/999", title: "Red Hat", vendor: "Globex", top_row: "TRUE", sku: "RH-1" },
  ];
}

test("equals_any on a GID column matches the bare numeric id the merchant types", () => {
  const filters = [{ column: "product_id", operator: "equals_any", value: "8590259323055" }];
  const out = applyAdvancedFilters(productRows(), filters);
  // Keeps the matching product AND its variant row; drops the other product.
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Blue Shirt");
  assert.equal(out[1].sku, "BS-2");
});

test("no active filters → rows unchanged", () => {
  const rows = productRows();
  assert.equal(applyAdvancedFilters(rows, []), rows);
  assert.equal(applyAdvancedFilters(rows, [{ column: "vendor", operator: "equals_any", value: "" }]).length, 3);
});

test("equals_any with a comma list matches any listed value", () => {
  const filters = [{ column: "vendor", operator: "equals_any", value: "globex, initech" }];
  const out = applyAdvancedFilters(productRows(), filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Red Hat");
});

test("not_equal_any drops records equal to any listed value", () => {
  const filters = [{ column: "vendor", operator: "not_equal_any", value: "Acme" }];
  const out = applyAdvancedFilters(productRows(), filters);
  assert.equal(out.length, 1);
  assert.equal(out[0].vendor, "Globex");
});

test("contains_any / starts_with_any operate case-insensitively", () => {
  assert.equal(applyAdvancedFilters(productRows(), [{ column: "title", operator: "contains_any", value: "shirt" }]).length, 2);
  assert.equal(applyAdvancedFilters(productRows(), [{ column: "title", operator: "starts_with_any", value: "red" }]).length, 1);
});

test("is_empty / is_not_empty need no value", () => {
  const rows = [
    { path: "/a", target: "/x", top_row: "" },
    { path: "/b", target: "",   top_row: "" },
  ];
  // No top_row markers → each row is its own record.
  assert.equal(applyAdvancedFilters(rows, [{ column: "target", operator: "is_empty" }]).length, 1);
  assert.equal(applyAdvancedFilters(rows, [{ column: "target", operator: "is_not_empty" }]).length, 1);
});

test("multiple filters are AND-ed on the record's top row", () => {
  const filters = [
    { column: "vendor", operator: "equals_any", value: "Acme" },
    { column: "title", operator: "contains_any", value: "shirt" },
  ];
  assert.equal(applyAdvancedFilters(productRows(), filters).length, 2); // Blue Shirt + variant
  const none = [
    { column: "vendor", operator: "equals_any", value: "Acme" },
    { column: "title", operator: "contains_any", value: "hat" },
  ];
  assert.equal(applyAdvancedFilters(productRows(), none).length, 0);
});

test("activeAdvancedFilters drops blank/incomplete rows", () => {
  const active = activeAdvancedFilters([
    { column: "vendor", operator: "equals_any", value: "Acme" }, // ok
    { column: "", operator: "equals_any", value: "x" },          // no column
    { column: "title", operator: "equals_any", value: "  " },    // blank value
    { column: "sku", operator: "is_empty" },                     // valueless ok
  ]);
  assert.equal(active.length, 2);
});

test("matchesAdvancedFilters tests a single top row", () => {
  const top = { product_id: "gid://shopify/Product/42", vendor: "Acme" };
  assert.equal(matchesAdvancedFilters(top, [{ column: "product_id", operator: "equals_any", value: "42" }]), true);
  assert.equal(matchesAdvancedFilters(top, [{ column: "product_id", operator: "equals_any", value: "43" }]), false);
});
