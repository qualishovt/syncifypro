/**
 * Migration output contract: the workbook a migration produces (app product/
 * customer row shape + snake_case columns) must round-trip through the import
 * analyzer as the right entity, so the staged file is importable as-is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { toExcelWorkbook } from "../export/formats/excel.js";
import { analyzeWorkbook } from "../import/importJob.js";

test("a WooCommerce-shaped product workbook imports as Products", () => {
  const rows = [
    {
      command: "MERGE", handle: "blue-shirt", title: "Blue Shirt", body_html: "<p>Nice</p>",
      vendor: "", product_type: "Shirts", tags: "sale", status: "ACTIVE", published: "TRUE",
      image_url: "https://x/a.jpg", sku: "BS-1", price: "19.99", compare_at_price: "24.99",
      inventory_qty: "5", row_number: 1, top_row: "TRUE",
    },
  ];
  const columns = ["command", "handle", "title", "body_html", "vendor", "product_type", "tags",
    "status", "published", "image_url", "sku", "price", "compare_at_price", "inventory_qty", "row_number", "top_row"];

  const buffer = toExcelWorkbook([{ name: "Products", rows, columns }]);
  const { sheets, totals } = analyzeWorkbook({ fileBuffer: buffer, format: "xlsx" });
  const products = sheets.find((s) => s.name === "Products");

  assert.equal(products.entity, "products");
  assert.equal(products.ok, true);
  assert.equal(products.valid, 1);
  assert.ok(totals.importable >= 1);
});

test("a WooCommerce-shaped customer workbook imports as Customers", () => {
  const rows = [
    {
      command: "MERGE", email: "a@b.com", first_name: "Zoe", last_name: "Q", phone: "555",
      address1: "1 St", address_city: "Baku", address_country: "AZ", address_zip: "1000",
      address_top_row: "TRUE", address_row_number: 1, row_number: 1, top_row: "TRUE",
    },
  ];
  const columns = ["command", "email", "first_name", "last_name", "phone",
    "address1", "address_city", "address_country", "address_zip", "address_top_row", "address_row_number", "row_number", "top_row"];

  const buffer = toExcelWorkbook([{ name: "Customers", rows, columns }]);
  const { sheets } = analyzeWorkbook({ fileBuffer: buffer, format: "xlsx" });
  const customers = sheets.find((s) => s.name === "Customers");

  assert.equal(customers.entity, "customers");
  assert.equal(customers.ok, true);
  assert.equal(customers.valid, 1);
});

test("a WooCommerce-shaped order workbook imports as Orders (2 line items = 1 order)", () => {
  const rows = [
    {
      command: "NEW", line_type: "Line Item", order_name: "#1001", email: "a@b.com",
      financial_status: "PAID", fulfillment_status: "FULFILLED", currency: "USD",
      created_at: "2024-01-02T10:00:00", billing_first_name: "Zoe", billing_city: "Baku",
      line_item_title: "Blue Shirt", line_item_name: "Blue Shirt", line_item_quantity: "2",
      line_item_price: "19.99", line_item_sku: "BS-1", row_number: 1, top_row: "TRUE",
    },
    {
      line_type: "Line Item", line_item_title: "Red Hat", line_item_name: "Red Hat",
      line_item_quantity: "1", line_item_price: "9.99", line_item_sku: "RH-1",
      row_number: 2, top_row: "",
    },
  ];
  const columns = ["command", "line_type", "order_name", "email", "financial_status", "fulfillment_status",
    "currency", "created_at", "billing_first_name", "billing_city",
    "line_item_title", "line_item_name", "line_item_quantity", "line_item_price", "line_item_sku", "row_number", "top_row"];

  const buffer = toExcelWorkbook([{ name: "Orders", rows, columns }]);
  const { sheets } = analyzeWorkbook({ fileBuffer: buffer, format: "xlsx" });
  const orders = sheets.find((s) => s.name === "Orders");

  assert.equal(orders.entity, "orders");
  assert.equal(orders.ok, true);
  assert.equal(orders.intent.create, 1); // both rows = one order record
});

test("a WooCommerce-shaped collection workbook imports as Collections", () => {
  const rows = [{
    command: "MERGE", handle: "shirts", title: "Shirts", body_html: "<p>Tops</p>",
    collection_type: "smart", rules_match: "any",
    rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: "Shirts" }]),
    image_url: "https://x/c.jpg",
  }];
  const columns = ["command", "handle", "title", "body_html", "collection_type", "rules_match", "rules", "image_url"];
  const buffer = toExcelWorkbook([{ name: "Collections", rows, columns }]);
  const { sheets } = analyzeWorkbook({ fileBuffer: buffer, format: "xlsx" });
  const collections = sheets.find((s) => s.name === "Collections");
  assert.equal(collections.entity, "collections");
  assert.equal(collections.ok, true);
  assert.equal(collections.valid, 1);
});

test("a WooCommerce-shaped discount workbook imports as Discounts", () => {
  const rows = [{
    command: "MERGE", codes: "SAVE10", title: "SAVE10", value_type: "percentage", value: "10",
    ends_at: "2025-12-31", usage_limit: "100", once_per_customer: "TRUE", minimum_subtotal: "50",
  }];
  const columns = ["command", "codes", "title", "value_type", "value", "ends_at", "usage_limit", "once_per_customer", "minimum_subtotal"];
  const buffer = toExcelWorkbook([{ name: "Discounts", rows, columns }]);
  const { sheets } = analyzeWorkbook({ fileBuffer: buffer, format: "xlsx" });
  const discounts = sheets.find((s) => s.name === "Discounts");
  assert.equal(discounts.entity, "discounts");
  assert.equal(discounts.ok, true);
  assert.equal(discounts.valid, 1);
});
