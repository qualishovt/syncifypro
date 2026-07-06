/**
 * import/writers/orderImport.test.js
 *
 * Proves the orders import vertical: a multi-row order group (line items +
 * transaction) → orderCreate/orderUpdate inputs, Command dispatch, record-
 * aware validation, and a full export→CSV→import round-trip. Run `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toCSV } from "../../export/formats/csv.js";
import { ORDER_FIELDS } from "../../export/fieldLists.js";
import { parseCSV } from "../parsers/csv.js";
import { normalizeHeaders } from "../headers.js";
import { groupRecords } from "../assemble.js";
import { COMMAND } from "../command.js";
import { validateOrderRows } from "../validators/orders.js";
import { buildOrderInput } from "./orderInput.js";

/** An order: 1 variant line, 1 custom line, 1 transaction. */
function orderGroup(overrides = {}) {
  const top = {
    line_type: "Line Item", top_row: "true", command: "",
    order_id: "555", order_name: "#1001", email: "jane@example.com",
    currency: "USD", financial_status: "PAID", processed_at: "2024-03-15T10:00:00Z",
    tags: "vip, wholesale", note: "Leave at door", customer_id: "99",
    billing_address1: "150 Elgin St", billing_city: "Ottawa",
    billing_province_code: "ON", billing_country_code: "CA", billing_zip: "K2P 1L4",
    shipping_address1: "150 Elgin St", shipping_city: "Ottawa",
    shipping_province_code: "ON", shipping_country_code: "CA", shipping_zip: "K2P 1L4",
    shipping_line_title: "Standard", shipping_line_price: "9.99",
    line_item_variant_id: "1", line_item_quantity: "2", line_item_title: "Blue Tee",
    ...overrides,
  };
  const customLine = {
    line_type: "Line Item", top_row: "", command: "",
    line_item_title: "Custom Mug", line_item_quantity: "1", line_item_price: "9.99", line_item_sku: "MUG",
  };
  const txn = {
    line_type: "Transaction", top_row: "", command: "",
    transaction_kind: "SALE", transaction_status: "SUCCESS",
    transaction_gateway: "manual", transaction_amount: "29.98", transaction_currency: "USD",
  };
  return [top, customLine, txn];
}

test("buildOrderInput maps a multi-row order to orderCreate input", () => {
  const { command, orderId, create, update } = buildOrderInput(orderGroup());

  assert.equal(command, COMMAND.MERGE);
  assert.equal(orderId, "gid://shopify/Order/555");
  assert.equal(create.name, "#1001");
  assert.equal(create.email, "jane@example.com");
  assert.deepEqual(create.tags, ["vip", "wholesale"]);
  assert.equal(create.financialStatus, "PAID");
  assert.equal(create.processedAt, "2024-03-15T10:00:00Z");
  assert.deepEqual(create.customer, { toAssociate: { id: "gid://shopify/Customer/99" } });

  // line items: variant line + custom line
  assert.equal(create.lineItems.length, 2);
  assert.deepEqual(create.lineItems[0], { variantId: "gid://shopify/ProductVariant/1", quantity: 2 });
  assert.equal(create.lineItems[1].title, "Custom Mug");
  assert.deepEqual(create.lineItems[1].priceSet, { shopMoney: { amount: "9.99", currencyCode: "USD" } });
  assert.equal(create.lineItems[1].sku, "MUG");

  // addresses + shipping line + transaction
  assert.equal(create.billingAddress.city, "Ottawa");
  assert.equal(create.billingAddress.countryCode, "CA");
  assert.equal(create.shippingLines[0].title, "Standard");
  assert.equal(create.transactions.length, 1);
  assert.deepEqual(create.transactions[0], {
    kind: "SALE", status: "SUCCESS", gateway: "manual",
    amountSet: { shopMoney: { amount: "29.98", currencyCode: "USD" } },
  });

  // update input is the narrow mutable subset
  assert.deepEqual(Object.keys(update).sort(), ["email", "id", "note", "shippingAddress", "tags"]);
  assert.equal(update.id, "gid://shopify/Order/555");
});

test("custom line item with no variant uses title + priceSet", () => {
  const { create } = buildOrderInput([
    { line_type: "Line Item", top_row: "true", order_name: "#2", currency: "USD",
      line_item_title: "Widget", line_item_quantity: "3", line_item_price: "5.00" },
  ]);
  assert.equal(create.lineItems.length, 1);
  assert.equal(create.lineItems[0].variantId, undefined);
  assert.equal(create.lineItems[0].title, "Widget");
  assert.equal(create.lineItems[0].quantity, 3);
});

test("validator: valid order keeps all its rows", () => {
  const { valid, errors } = validateOrderRows(orderGroup());
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(valid.length, 3);
});

test("validator: new order with no line items is rejected", () => {
  const { errors } = validateOrderRows([
    { line_type: "Line Item", top_row: "true", command: "NEW", order_name: "#9" },
  ]);
  assert.ok(errors.some((e) => e.field === "line_item_title"));
});

test("validator: DELETE without order_id is rejected", () => {
  const { errors } = validateOrderRows([
    { line_type: "Line Item", top_row: "true", command: "DELETE", order_id: "" },
  ]);
  assert.ok(errors.some((e) => e.message.includes("DELETE")));
});

test("validator: invalid financial status and bad quantity are caught", () => {
  const [top, custom, txn] = orderGroup();
  const { errors } = validateOrderRows([{ ...top, financial_status: "WAT", line_item_quantity: "two" }, custom, txn]);
  assert.ok(errors.some((e) => e.field === "financial_status"));
  assert.ok(errors.some((e) => e.field === "line_item_quantity"));
});

test("full round-trip: export order rows → CSV → import → orderCreate input", () => {
  const csv = toCSV(orderGroup(), ORDER_FIELDS);        // humanized headers
  const rows = normalizeHeaders(parseCSV(csv), "orders"); // back to snake_case

  const { valid, errors } = validateOrderRows(rows);
  assert.equal(errors.length, 0, JSON.stringify(errors));

  const groups = groupRecords(valid);
  assert.equal(groups.length, 1);            // 3 rows → one order
  const { create } = buildOrderInput(groups[0]);
  assert.equal(create.name, "#1001");
  assert.equal(create.lineItems.length, 2);
  assert.equal(create.transactions.length, 1);
});
