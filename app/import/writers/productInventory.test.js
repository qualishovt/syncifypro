/**
 * import/writers/productInventory.test.js
 *
 * Pure-function coverage for the per-location inventory column parsing —
 * the inverse of export/inventoryColumns.js. Run with `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildInventoryFieldKeys } from "../../export/inventoryColumns.js";
import { parseInventoryColumn, collectInventory, buildLocationMap } from "./productInventory.js";

test("parseInventoryColumn understands state, location, and Adjust", () => {
  assert.deepEqual(parseInventoryColumn("Inventory Available: Main"),
    { name: "available", locationName: "Main", isAdjust: false });
  assert.deepEqual(parseInventoryColumn("Inventory On Hand: Main Warehouse"),
    { name: "on_hand", locationName: "Main Warehouse", isAdjust: false });
  assert.deepEqual(parseInventoryColumn("Inventory Available Adjust: Main"),
    { name: "available", locationName: "Main", isAdjust: true });
  assert.equal(parseInventoryColumn("Variant SKU"), null);
  assert.equal(parseInventoryColumn("Metafield: custom.x [t]"), null);
});

test("every export inventory header parses back", () => {
  // Whatever export can emit, import must be able to read.
  const keys = buildInventoryFieldKeys([{ name: "Main" }, { name: "Shop 2" }]);
  for (const key of keys) {
    assert.notEqual(parseInventoryColumn(key), null, `unparsed: ${key}`);
  }
});

test("collectInventory splits settable vs adjustable, drops blanks/zeros", () => {
  const { sets, adjusts } = collectInventory({
    "Inventory Available: Main": "42",
    "Inventory Available: Backup": "7",
    "Inventory On Hand: Main": "50",
    "Inventory Available Adjust: Main": "",     // blank → ignored
    "Inventory Damaged Adjust: Main": "-3",
    "Inventory Committed: Main": "5",           // not settable → ignored
    "Inventory Quality Control Adjust: Main": "0", // zero delta → ignored
    sku: "R",
  });

  assert.deepEqual(sets.sort((a, b) => a.locationName.localeCompare(b.locationName)), [
    { name: "available", locationName: "Backup", quantity: 7 },
    { name: "available", locationName: "Main", quantity: 42 },
    { name: "on_hand", locationName: "Main", quantity: 50 },
  ]);
  assert.deepEqual(adjusts, [{ name: "damaged", locationName: "Main", delta: -3 }]);
});

test("buildLocationMap is case-insensitive", () => {
  const map = buildLocationMap([{ id: "gid://shopify/Location/1", name: "Main Warehouse" }]);
  assert.equal(map.get("main warehouse"), "gid://shopify/Location/1");
});
