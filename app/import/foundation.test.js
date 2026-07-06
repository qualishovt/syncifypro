/**
 * import/foundation.test.js
 *
 * Proves the import foundation is the exact inverse of the export layer:
 * a file this app exports (humanized headers, exploded multi-row records)
 * re-imports losslessly. Run with `npm test` (node --test).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { FIELDS_BY_ENTITY } from "../export/fieldLists.js";
import { toCSV } from "../export/formats/csv.js";
import { parseCSV } from "./parsers/csv.js";
import { normalizeHeaders, reverseHeaderMap } from "./headers.js";
import { groupRecords } from "./assemble.js";
import { parseCommand, COMMAND } from "./command.js";

test("every entity's labels reverse without collision", () => {
  for (const entity of Object.keys(FIELDS_BY_ENTITY)) {
    assert.doesNotThrow(() => reverseHeaderMap(entity), `collision in ${entity}`);
  }
});

test("all columns round-trip export→CSV→parse→reverse for every entity", () => {
  for (const entity of Object.keys(FIELDS_BY_ENTITY)) {
    const keys = FIELDS_BY_ENTITY[entity];
    const row = Object.fromEntries(keys.map((k) => [k, `v_${k}`]));
    const csv = toCSV([row], keys);
    const [back] = normalizeHeaders(parseCSV(csv), entity);
    const lost = keys.filter((k) => back[k] !== `v_${k}`);
    assert.equal(lost.length, 0, `${entity} lost: ${lost.join(", ")}`);
  }
});

test("export writes humanized headers, not raw keys", () => {
  const csv = toCSV(
    [{ product_id: "1", sku: "A", body_html: "<p>x</p>" }],
    ["product_id", "sku", "body_html"],
  ).toString();
  assert.equal(csv.split("\r\n")[0], "ID,Variant SKU,Body HTML");
});

test("unknown/dynamic columns pass through header reversal unchanged", () => {
  const rows = [{ "Metafield: custom.x [single_line_text_field]": "hi", "ID": "7" }];
  const [back] = normalizeHeaders(rows, "products");
  assert.equal(back["Metafield: custom.x [single_line_text_field]"], "hi");
  assert.equal(back.product_id, "7");
});

test("groupRecords regroups exploded multi-row records", () => {
  const rows = [
    { top_row: "true", line_type: "Line Item", order_id: "1" },
    { top_row: "", line_type: "Line Item", order_id: "" },
    { top_row: "", line_type: "Transaction", order_id: "" },
    { top_row: "true", line_type: "Line Item", order_id: "2" },
  ];
  const groups = groupRecords(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 3);
  assert.equal(groups[1].length, 1);
});

test("groupRecords treats a flat entity as one record per row", () => {
  const groups = groupRecords([{ path: "/a" }, { path: "/b" }, { path: "/c" }]);
  assert.equal(groups.length, 3);
});

test("command parsing: default, aliases, and strict unknown", () => {
  assert.equal(parseCommand(""), COMMAND.MERGE);
  assert.equal(parseCommand("delete"), COMMAND.DELETE);
  assert.equal(parseCommand("Create"), COMMAND.NEW);
  assert.throws(() => parseCommand("frobnicate"));
});
