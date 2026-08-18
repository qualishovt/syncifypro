/**
 * migrations/magento.test.js
 *
 * The Magento connector's pure mapping against fixture payloads shaped like
 * the real /rest/V1 responses: configurable products become variant rows,
 * filters become searchCriteria groups, categories/customers/orders/coupons
 * map to the app's rows, and redirects are generated from url keys.
 * Run with `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  mapMagentoProducts, mapMagentoCategories, mapMagentoCustomers, mapMagentoOrders,
  mapMagentoCoupons, mapMagentoRedirects, magentoCriteria, criteriaQuery,
} from "./magento.server.js";
import { filtersFor } from "./platforms.js";

const creds = { baseUrl: "https://shop.example.com/", accessToken: "t" };
const ca = (obj) => Object.entries(obj).map(([attribute_code, value]) => ({ attribute_code, value }));

const catMap = new Map([[3, "Tops"], [4, "Hoodies"]]);

const configurable = {
  sku: "HOODIE", name: "Pullover Hoodie", type_id: "configurable", status: 1, visibility: 4, price: 0,
  custom_attributes: ca({ url_key: "pullover-hoodie", description: "<p>Warm</p>" }),
  media_gallery_entries: [{ file: "/h/hoodie.jpg" }, { file: "/h/hoodie-back.jpg" }],
  extension_attributes: {
    category_links: [{ category_id: "4" }, { category_id: "3" }],
    configurable_product_options: [
      { attribute_id: "93", label: "Color", values: [{ value_index: 49 }, { value_index: 50 }] },
      { attribute_id: "141", label: "Size", values: [{ value_index: 166 }] },
    ],
  },
};
const child = (sku, color, size, price, qty) => ({
  sku, name: `Pullover Hoodie-${sku}`, type_id: "simple", status: 1, visibility: 1, price, weight: 0.8,
  custom_attributes: ca({ color: String(color), size: String(size) }),
  extension_attributes: { stock_item: { qty } },
});
const simple = {
  sku: "CAP", name: "Cap", type_id: "simple", status: 2, visibility: 4, price: 12, weight: 0.2,
  custom_attributes: ca({ url_key: "cap", short_description: "A cap" }),
  extension_attributes: { category_links: [{ category_id: "3" }], stock_item: { qty: 7 } },
};
const attributesById = new Map([
  [93,  { code: "color", label: "Color", values: new Map([["49", "Black"], ["50", "Grey"]]) }],
  [141, { code: "size",  label: "Size",  values: new Map([["166", "M"]]) }],
]);

test("configurable product → one row per child variant with option labels", () => {
  const rows = mapMagentoProducts({
    products: [configurable, child("HOODIE-BLK-M", 49, 166, 45, 3), child("HOODIE-GRY-M", 50, 166, 47, 0), simple],
    catMap, attributesById, creds,
    childrenBySku: new Map([["HOODIE", [child("HOODIE-BLK-M", 49, 166, 45, 3), child("HOODIE-GRY-M", 50, 166, 47, 0)]]]),
  });

  // Hoodie: 2 variant rows + 1 extra-image row; Cap: 1 row. Children not duplicated.
  assert.equal(rows.length, 4);
  const [v1, v2, img, cap] = rows;
  assert.equal(v1.handle, "pullover-hoodie");
  assert.equal(v1.top_row, "TRUE");
  assert.deepEqual([v1.option1_name, v1.option1_value, v1.option2_name, v1.option2_value], ["Color", "Black", "Size", "M"]);
  assert.equal(v1.sku, "HOODIE-BLK-M");
  assert.equal(v1.price, "45");
  assert.equal(v1.inventory_qty, "3");
  assert.equal(v1.tags, "Hoodies, Tops");
  assert.equal(v1.image_url, "https://shop.example.com/media/catalog/product/h/hoodie.jpg");
  assert.equal(v2.top_row, "");
  assert.deepEqual([v2.option1_value, v2.sku, v2.inventory_qty], ["Grey", "HOODIE-GRY-M", "0"]);
  assert.equal(img.image_url, "https://shop.example.com/media/catalog/product/h/hoodie-back.jpg");
  // Simple, disabled product: single row, DRAFT.
  assert.equal(cap.handle, "cap");
  assert.equal(cap.status, "DRAFT");
  assert.equal(cap.option1_name, undefined);
  assert.equal(cap.inventory_qty, "7");
});

test("configurable without loadable children falls back to a single row", () => {
  const rows = mapMagentoProducts({ products: [configurable], catMap, attributesById, creds, childrenBySku: new Map() });
  assert.equal(rows.length, 2); // product row + extra image row
  assert.equal(rows[0].sku, "HOODIE");
});

test("filters map to Magento searchCriteria groups", () => {
  const c = magentoCriteria("products", {
    product_status: ["enabled"], product_created_after: "2026-01-01", product_updated_before: "2026-06-30",
  });
  assert.deepEqual(c, [
    { field: "status", value: "1", condition: "in" },
    { field: "created_at", value: "2026-01-01 00:00:00", condition: "gteq" },
    { field: "updated_at", value: "2026-06-30 00:00:00", condition: "lt" },
  ]);
  const o = magentoCriteria("orders", { order_status: ["complete", "processing"], product_status: ["enabled"] });
  assert.deepEqual(o, [{ field: "status", value: "complete,processing", condition: "in" }]);
  assert.equal(
    criteriaQuery([{ field: "status", value: "1", condition: "eq" }]),
    "&searchCriteria[filter_groups][0][filters][0][field]=status&searchCriteria[filter_groups][0][filters][0][value]=1&searchCriteria[filter_groups][0][filters][0][condition_type]=eq",
  );
});

test("Magento's filter set uses its own statuses and drops customer role", () => {
  const f = filtersFor("magento");
  assert.deepEqual(f.find((x) => x.key === "product_status").options, ["enabled", "disabled"]);
  assert.ok(f.find((x) => x.key === "order_status").options.includes("holded"));
  assert.equal(f.find((x) => x.key === "customer_role"), undefined);
  // WooCommerce keeps the defaults.
  assert.ok(filtersFor("woocommerce").find((x) => x.key === "customer_role"));
});

test("categories, customers, orders, coupons map to app rows", () => {
  const cats = mapMagentoCategories([
    { id: 1, name: "Root Catalog", level: 0 },
    { id: 2, name: "Default Category", level: 1 },
    { id: 4, name: "Hoodies", level: 2, custom_attributes: ca({ url_key: "hoodies", url_path: "men/hoodies" }) },
  ]);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].handle, "hoodies");
  assert.equal(JSON.parse(cats[0].rules)[0].condition, "Hoodies");

  const cust = mapMagentoCustomers([{
    email: "a@x.com", firstname: "Ann", lastname: "Lee",
    addresses: [{ street: ["1 Main St", "Apt 2"], city: "Austin", region: { region: "Texas" }, country_id: "US", postcode: "78701", telephone: "555" }],
  }, { email: "", firstname: "No", lastname: "Mail" }]);
  assert.equal(cust.length, 1);
  assert.deepEqual([cust[0].address1, cust[0].address2, cust[0].address_province, cust[0].phone], ["1 Main St", "Apt 2", "Texas", "555"]);

  const orders = mapMagentoOrders([{
    increment_id: "000000012", status: "complete", customer_email: "a@x.com", order_currency_code: "USD",
    grand_total: 57.5, shipping_amount: 5, shipping_description: "Flat Rate", created_at: "2026-02-01 10:00:00",
    billing_address: { firstname: "Ann", lastname: "Lee", street: ["1 Main St"], city: "Austin", region: "Texas", postcode: "78701", country_id: "US" },
    extension_attributes: { shipping_assignments: [{ shipping: { address: { firstname: "Ann", lastname: "Lee", street: ["9 Ship Rd"], city: "Dallas", region: "Texas", postcode: "75001", country_id: "US" } } }] },
    items: [
      { name: "Pullover Hoodie", sku: "HOODIE-BLK-M", qty_ordered: 1, price: 45, parent_item_id: null },
      { name: "Pullover Hoodie-BLK-M", sku: "HOODIE-BLK-M", qty_ordered: 1, price: 0, parent_item_id: 7 }, // child line, skipped
      { name: "Cap", sku: "CAP", qty_ordered: 1, price: 12, parent_item_id: null },
    ],
  }]);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].order_name, "#000000012");
  assert.equal(orders[0].financial_status, "PAID");
  assert.equal(orders[0].fulfillment_status, "FULFILLED");
  assert.equal(orders[0].shipping_city, "Dallas");
  assert.equal(orders[0].shipping_line_title, "Flat Rate");
  assert.equal(orders[1].line_item_sku, "CAP");
  assert.equal(orders[1].order_name, undefined);

  const disc = mapMagentoCoupons(
    [{ code: "SAVE10", rule_id: 1, usage_limit: 100 }, { code: "FREESHIP", rule_id: 2 }],
    [{ rule_id: 1, name: "Ten off", simple_action: "by_percent", discount_amount: 10, uses_per_customer: 1, to_date: "2026-12-31" },
     { rule_id: 2, name: "Free ship", simple_action: "buy_x_get_y", discount_amount: 0 }],
  );
  assert.equal(disc.length, 1); // buy_x_get_y has no Shopify equivalent here
  assert.deepEqual([disc[0].codes, disc[0].value_type, disc[0].value, disc[0].once_per_customer, disc[0].usage_limit], ["SAVE10", "percentage", "10", "TRUE", "100"]);
});

test("redirects: /url_key.html → /products, /url_path.html → /collections", () => {
  const rows = mapMagentoRedirects({
    products: [configurable, child("HOODIE-BLK-M", 49, 166, 45, 3), simple],
    cats: [
      { id: 2, name: "Default Category", level: 1 },
      { id: 4, name: "Hoodies", level: 2, custom_attributes: ca({ url_key: "hoodies", url_path: "men/hoodies" }) },
    ],
  });
  assert.deepEqual(rows, [
    { command: "MERGE", path: "/pullover-hoodie.html", target: "/products/pullover-hoodie" },
    { command: "MERGE", path: "/cap.html", target: "/products/cap" },
    { command: "MERGE", path: "/men/hoodies.html", target: "/collections/hoodies" },
  ]);
});
