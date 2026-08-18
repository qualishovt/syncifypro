/**
 * migrations/filters.test.js
 *
 * The per-platform filter mappers: BigCommerce (query params + client-side
 * predicate) and PrestaShop (Webservice filter[...] params), plus the
 * per-platform filter vocab from filtersFor(). Run with `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { bcFilters } from "./bigcommerce.server.js";
import { psQuery } from "./prestashop.server.js";
import { filtersFor } from "./platforms.js";

test("BigCommerce: visibility + modified dates go to the API, created dates are checked client-side", () => {
  const f = bcFilters("products", { product_status: ["visible"], product_updated_after: "2026-01-01", product_created_after: "2026-06-01" });
  assert.match(f.query, /is_visible=true/);
  assert.match(f.query, /date_modified:min=2026-01-01T00%3A00%3A00\.000Z/);
  assert.equal(f.keep({ date_created: "2026-07-01T00:00:00+00:00" }), true);
  assert.equal(f.keep({ date_created: "2026-05-01T00:00:00+00:00" }), false);
  // No filters → no query, keep everything.
  const none = bcFilters("customers", {});
  assert.equal(none.query, "");
  assert.equal(none.keep({}), true);
});

test("BigCommerce: order status list is matched client-side, dates via V2 min/max params", () => {
  const f = bcFilters("orders", { order_status: ["Completed", "Shipped"], order_created_after: "2026-01-01" });
  assert.match(f.query, /min_date_created=/);
  assert.equal(f.keep({ status: "Shipped", date_created: "Tue, 10 Feb 2026 10:00:00 +0000" }), true);
  assert.equal(f.keep({ status: "Pending", date_created: "Tue, 10 Feb 2026 10:00:00 +0000" }), false);
});

test("PrestaShop: active flag, state names → ids, and interval date filters", () => {
  assert.equal(psQuery("products", { product_status: ["active"] }), "&filter[active]=[1]");
  const o = psQuery("orders", { order_status: ["Payment accepted", "Shipped"], order_created_after: "2026-01-01", order_created_before: "2026-02-01" });
  assert.match(o, /&filter\[current_state\]=\[2\|4\]/);
  assert.match(o, /&filter\[date_add\]=\[2026-01-01%2000%3A00%3A00,2026-02-01%2000%3A00%3A00\]&date=1/);
  // Open-ended range gets a far bound so the interval syntax stays valid.
  assert.match(psQuery("customers", { customer_created_after: "2026-01-01" }), /\[2026-01-01%2000%3A00%3A00,2100-01-01%2000%3A00%3A00\]&date=1/);
  assert.equal(psQuery("customers", {}), "");
});

test("filtersFor gives each platform its own vocabulary", () => {
  assert.deepEqual(filtersFor("bigcommerce").find((f) => f.key === "product_status").options, ["visible", "hidden"]);
  assert.deepEqual(filtersFor("prestashop").find((f) => f.key === "product_status").options, ["active", "inactive"]);
  assert.ok(filtersFor("prestashop").find((f) => f.key === "order_status").options.includes("Payment accepted"));
  for (const p of ["bigcommerce", "prestashop", "magento"]) assert.equal(filtersFor(p).find((f) => f.key === "customer_role"), undefined);
  assert.ok(filtersFor("woocommerce").find((f) => f.key === "customer_role"));
});
