/**
 * export/formats/googleFeed.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toGoogleFeed } from "./googleFeed.js";

const CTX = { shopName: "Data & Engine", currency: "USD", domain: "shop.example.com" };

const variantRow = (over = {}) => ({
  product_id: "111",
  variant_id: "222",
  handle: "snowboard",
  title: "Snowboard",
  body_html: "<p>Fast &amp; light</p>",
  vendor: "DataEngine",
  product_type: "Boards",
  url: "",
  image_url: "https://cdn.example.com/board.jpg",
  variant_image: "",
  option1_value: "Blue",
  option2_value: "",
  option3_value: "",
  sku: "SNB-1",
  barcode: "12345678",
  price: "80",
  compare_at_price: "100",
  inventory_qty: 4,
  inventory_policy: "DENY",
  gs_mpn: "",
  gs_condition: "",
  gs_google_product_category: "",
  gs_age_group: "", gs_gender: "", gs_color: "", gs_material: "",
  gs_size: "", gs_size_system: "", gs_custom_product: "",
  ...over,
});

test("toGoogleFeed writes a Merchant Center RSS item per variant row", () => {
  const xml = toGoogleFeed([variantRow()], undefined, "products", CTX).toString("utf8");

  assert.ok(xml.includes('xmlns:g="http://base.google.com/ns/1.0"'), "g: namespace");
  assert.ok(xml.includes("<title>Data &amp; Engine</title>"), "escaped channel title");
  assert.ok(xml.includes("<g:id>SNB-1</g:id>"), "sku as id");
  assert.ok(xml.includes("<g:item_group_id>111</g:item_group_id>"), "product groups variants");
  assert.ok(xml.includes("<g:title>Snowboard - Blue</g:title>"), "variant options in title");
  assert.ok(xml.includes("<g:description>Fast &amp; light</g:description>"), "HTML stripped");
  assert.ok(
    xml.includes("<g:link>https://shop.example.com/products/snowboard?variant=222</g:link>"),
    "domain fallback link with variant param",
  );
  assert.ok(xml.includes("<g:availability>in stock</g:availability>"), "qty > 0 in stock");
  assert.ok(xml.includes("<g:price>100.00 USD</g:price>"), "compare-at is the base price");
  assert.ok(xml.includes("<g:sale_price>80.00 USD</g:sale_price>"), "price is the sale price");
  assert.ok(xml.includes("<g:gtin>12345678</g:gtin>"), "barcode as gtin");
  assert.ok(xml.includes("<g:condition>new</g:condition>"), "condition defaults to new");
});

test("toGoogleFeed skips non-variant rows and empty fields", () => {
  const imageOnly = variantRow({ variant_id: "", sku: "", price: "", barcode: "" });
  const oos = variantRow({ inventory_qty: 0, compare_at_price: "" });
  const xml = toGoogleFeed([imageOnly, oos], undefined, "products", CTX).toString("utf8");

  assert.equal(xml.match(/<item>/g)?.length, 1, "image-only row is not an item");
  assert.ok(xml.includes("<g:availability>out of stock</g:availability>"), "qty 0 out of stock");
  assert.ok(xml.includes("<g:price>80.00 USD</g:price>"), "no compare-at → price is base");
  assert.ok(!xml.includes("<g:sale_price>"), "no sale price without compare-at");
  assert.ok(!xml.includes("<g:google_product_category>"), "empty optional fields omitted");
});

test("toGoogleFeed falls back to plain XML for non-product entities", () => {
  const xml = toGoogleFeed([{ order_id: "9" }], ["order_id"], "orders", CTX).toString("utf8");
  assert.ok(xml.includes("<rows>"), "generic dialect root");
  assert.ok(!xml.includes("xmlns:g"), "no feed namespace");
});
