/**
 * import/assemble.test.js
 *
 * Record grouping without a Top Row column — the shape of Shopify's own CSV
 * export (repeated Handle on variant/image rows) and of hand-authored files.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { groupRecords } from "./assemble.js";

test("Shopify CSV: rows sharing a handle (or carrying none) form one product record", () => {
  const rows = [
    { handle: "tee", title: "Tee", option1_value: "S", image_url: "a.png" },
    { handle: "tee", option1_value: "M" },            // variant row (Shopify repeats Handle)
    { handle: "tee", image_url: "b.png" },            // image-only row
    { handle: "", image_url: "c.png" },               // Matrixify-style child row: no identifier
    { handle: "mug", title: "Mug", option1_value: "Default Title" },
    { handle: "tee", title: "Tee again" },            // same handle later, non-consecutive → separate record
  ];
  const groups = groupRecords(rows);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].length, 4);
  assert.equal(groups[1][0].handle, "mug");
  assert.equal(groups[2][0].title, "Tee again");
});

test("identity match is case- and whitespace-insensitive, and id wins over handle", () => {
  const groups = groupRecords([
    { id: "1", handle: "a" },
    { id: " 1 ", handle: "b" },   // same id → same record even though handle differs
    { id: "", handle: "B" },      // no id → child of the open record
    { handle: "b" },              // still no id → child
    { id: "2", handle: "b" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 4);
});

test("a row with an empty identifier but a Title/Command is a new record, not a child", () => {
  const groups = groupRecords([
    { id: "gid://x/1", handle: "shirt", title: "Blue Shirt" },
    { id: "", handle: "", title: "New Hat", command: "NEW" },   // create row after an update row
    { id: "", handle: "", image_url: "hat.png" },               // child of the hat
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].length, 2);
});

test("rows with no identifiers at all stay one record each (plain create file)", () => {
  const groups = groupRecords([
    { title: "One", price: "1" },
    { title: "Two", price: "2" },
    { title: "Three", price: "3" },
  ]);
  assert.equal(groups.length, 3);
});

test("a Top Row column still takes precedence over identity grouping", () => {
  const groups = groupRecords([
    { top_row: "TRUE", handle: "x" },
    { top_row: "", handle: "y" },      // different handle, but not a top row → child
    { top_row: "TRUE", handle: "x" },  // same handle, but a top row → new record
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
});
