import { test } from "node:test";
import assert from "node:assert/strict";
import { ocKeep } from "./opencart.server.js";
import { filtersFor } from "./platforms.js";

test("OpenCart product filters: status vocabulary + created/updated ranges", () => {
  const keep = ocKeep("products", { product_status: ["enabled"], product_created_after: "2026-07-01", product_updated_before: "2026-09-01" });
  assert.equal(keep({ status: true, date_added: "2026-07-28 10:08:35", date_modified: "2026-08-22 12:08:35" }), true);
  assert.equal(keep({ status: false, date_added: "2026-07-28 10:08:35", date_modified: "2026-08-22 12:08:35" }), false);
  assert.equal(keep({ status: true, date_added: "2026-06-30 23:59:59", date_modified: "2026-08-22 12:08:35" }), false);
  assert.equal(keep({ status: true, date_added: "2026-07-28 10:08:35", date_modified: "2026-09-01 00:00:00" }), false);
});

test("OpenCart order filters match status names case-insensitively", () => {
  const keep = ocKeep("orders", { order_status: ["Shipped", "complete"] });
  assert.equal(keep({ status: "Shipped", date_added: "2026-07-27 10:08:35" }), true);
  assert.equal(keep({ status: "Complete", date_added: "2026-07-27 10:08:35" }), true);
  assert.equal(keep({ status: "Pending", date_added: "2026-07-27 10:08:35" }), false);
  assert.equal(ocKeep("orders", {})({ status: "Pending" }), true);
});

test("OpenCart filter vocabulary is wired into filtersFor()", () => {
  const f = filtersFor("opencart");
  assert.deepEqual(f.find((x) => x.key === "product_status").options, ["enabled", "disabled"]);
  assert.ok(f.find((x) => x.key === "order_status").options.includes("Shipped"));
  assert.equal(f.find((x) => x.key === "customer_role"), undefined);
});
