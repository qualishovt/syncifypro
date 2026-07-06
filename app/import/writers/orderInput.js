/**
 * import/writers/orderInput.js
 *
 * Pure transform: an order's assembled row group (header-normalized, one row
 * per Line Item / Transaction / Refund / Fulfillment, distinguished by
 * `line_type`; first row carries the order-level fields) → the inputs the
 * order mutations expect.
 *
 * Shopify's order-write surface is far narrower than products:
 *   - orderCreate (OrderCreateOrderInput) creates an order with line items,
 *     customer, addresses, shipping lines, and transactions.
 *   - orderUpdate (OrderInput) only touches a few mutable fields (email, note,
 *     tags, shipping address) — NOT line items or totals.
 * So this builder produces BOTH a `create` and an `update` shape; the writer
 * picks based on the Command and whether the order already exists. Totals,
 * risk, refunds, and fulfillments are export-only / not settable here and are
 * intentionally not sent (documented limitation).
 *
 * Shapes are schema-validated against Admin API 2026-07.
 */

import { parseCommand } from "../command.js";
import { topRow } from "../assemble.js";

const FINANCIAL = new Set([
  "PENDING", "AUTHORIZED", "PARTIALLY_PAID", "PAID",
  "PARTIALLY_REFUNDED", "REFUNDED", "VOIDED", "EXPIRED",
]);

const clean = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : s;
};
const truthy = (v) => ["true", "1", "yes", "y", "x"].includes(String(v ?? "").trim().toLowerCase());
const intOr = (v, d) => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isNaN(n) ? d : n;
};
const rowsOfType = (group, type) => group.filter((r) => (r.line_type || "Line Item") === type);
const toGid = (type, id) => {
  const s = clean(id);
  return s === undefined ? undefined : s.startsWith("gid://") ? s : `gid://shopify/${type}/${s}`;
};

function money(amount, currency) {
  const a = clean(amount);
  if (a === undefined) return undefined;
  const set = { amount: a };
  if (clean(currency)) set.currencyCode = clean(currency);
  return { shopMoney: set };
}

function address(row, prefix) {
  const a = {};
  const map = {
    firstName: `${prefix}_first_name`, lastName: `${prefix}_last_name`,
    company: `${prefix}_company`, phone: `${prefix}_phone`,
    address1: `${prefix}_address1`, address2: `${prefix}_address2`,
    city: `${prefix}_city`, province: `${prefix}_province`,
    provinceCode: `${prefix}_province_code`, zip: `${prefix}_zip`,
    countryCode: `${prefix}_country_code`,
  };
  for (const [field, key] of Object.entries(map)) {
    if (clean(row[key]) !== undefined) a[field] = clean(row[key]);
  }
  return Object.keys(a).length ? a : undefined;
}

function lineItem(row, currency) {
  const quantity = intOr(row.line_item_quantity, 1);
  const variantId = toGid("ProductVariant", row.line_item_variant_id);
  if (variantId) return { variantId, quantity };
  // Custom (no variant) line item.
  const li = {
    title: clean(row.line_item_title) ?? clean(row.line_item_name) ?? "Line item",
    quantity,
  };
  const priceSet = money(row.line_item_price, currency);
  if (priceSet) li.priceSet = priceSet;
  if (clean(row.line_item_sku)) li.sku = clean(row.line_item_sku);
  if (clean(row.line_item_requires_shipping) !== undefined) li.requiresShipping = truthy(row.line_item_requires_shipping);
  if (clean(row.line_item_taxable) !== undefined) li.taxable = truthy(row.line_item_taxable);
  return li;
}

function transaction(row, currency) {
  const t = {};
  if (clean(row.transaction_kind)) t.kind = clean(row.transaction_kind).toUpperCase();
  if (clean(row.transaction_status)) t.status = clean(row.transaction_status).toUpperCase();
  if (clean(row.transaction_gateway)) t.gateway = clean(row.transaction_gateway);
  const amountSet = money(row.transaction_amount, row.transaction_currency ?? currency);
  if (amountSet) t.amountSet = amountSet;
  return Object.keys(t).length ? t : null;
}

function buildCreate(group) {
  const top = topRow(group);
  const currency = clean(top.currency);
  const order = {};

  if (clean(top.order_name)) order.name = clean(top.order_name);
  const email = clean(top.email) ?? clean(top.customer_email);
  if (email) order.email = email;
  if (clean(top.phone)) order.phone = clean(top.phone);
  if (clean(top.note)) order.note = clean(top.note);
  if (clean(top.tags)) order.tags = clean(top.tags).split(",").map((t) => t.trim()).filter(Boolean);
  if (currency) order.currency = currency;
  if (clean(top.financial_status) && FINANCIAL.has(clean(top.financial_status).toUpperCase())) {
    order.financialStatus = clean(top.financial_status).toUpperCase();
  }
  const processedAt = clean(top.processed_at) ?? clean(top.created_at);
  if (processedAt) order.processedAt = processedAt;

  // Customer: associate by id when known, else upsert by email.
  if (clean(top.customer_id)) {
    order.customer = { toAssociate: { id: toGid("Customer", top.customer_id) } };
  } else if (clean(top.customer_email)) {
    const c = { email: clean(top.customer_email) };
    if (clean(top.customer_first_name)) c.firstName = clean(top.customer_first_name);
    if (clean(top.customer_last_name)) c.lastName = clean(top.customer_last_name);
    order.customer = { toUpsert: c };
  }

  const lineItems = rowsOfType(group, "Line Item")
    .filter((r) => clean(r.line_item_variant_id) || clean(r.line_item_title) || clean(r.line_item_name))
    .map((r) => lineItem(r, currency));
  if (lineItems.length) order.lineItems = lineItems;

  const billing = address(top, "billing");
  if (billing) order.billingAddress = billing;
  const shipping = address(top, "shipping");
  if (shipping) order.shippingAddress = shipping;

  if (clean(top.shipping_line_title)) {
    const line = { title: clean(top.shipping_line_title) };
    if (clean(top.shipping_line_code)) line.code = clean(top.shipping_line_code);
    if (clean(top.shipping_line_source)) line.source = clean(top.shipping_line_source);
    const priceSet = money(top.shipping_line_price, currency);
    if (priceSet) line.priceSet = priceSet;
    order.shippingLines = [line];
  }

  const transactions = rowsOfType(group, "Transaction").map((r) => transaction(r, currency)).filter(Boolean);
  if (transactions.length) order.transactions = transactions;

  return order;
}

function buildUpdate(group, orderId) {
  const top = topRow(group);
  const input = { id: orderId };
  const email = clean(top.email) ?? clean(top.customer_email);
  if (email) input.email = email;
  if (clean(top.note)) input.note = clean(top.note);
  if (clean(top.tags)) input.tags = clean(top.tags).split(",").map((t) => t.trim()).filter(Boolean);
  const shipping = address(top, "shipping");
  if (shipping) input.shippingAddress = shipping;
  return input;
}

/**
 * @param {object[]} group - assembled rows for one order
 * @returns {{ command: string, orderId: string|undefined, create: object, update: object }}
 */
export function buildOrderInput(group) {
  const top = topRow(group);
  const command = parseCommand(top.command);
  const orderId = clean(top.order_id) ? toGid("Order", top.order_id) : undefined;
  return {
    command,
    orderId,
    create: buildCreate(group),
    update: orderId ? buildUpdate(group, orderId) : undefined,
  };
}
