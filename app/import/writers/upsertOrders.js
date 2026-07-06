/**
 * import/writers/upsertOrders.js
 *
 * Writes validated order rows to Shopify, on the import foundation:
 *   groupRecords()   → one record per order (its Line Item / Transaction /
 *                      Refund / Fulfillment rows)
 *   buildOrderInput  → schema-valid orderCreate / orderUpdate inputs
 *   Command          → MERGE/UPDATE/NEW/REPLACE/DELETE/IGNORE dispatch
 *
 * Order-write reality (documented limits):
 *   - orderCreate creates the order with line items, customer, addresses,
 *     shipping line, and transactions. Needs write_orders + an offline token.
 *   - orderUpdate can only change email/note/tags/shipping address — never
 *     line items or totals — so MERGE/UPDATE on an existing order is a light
 *     touch, not a full re-sync.
 *   - Refunds and fulfillments are not created here (export-only for now).
 *
 * Rate limit: dev/trial stores allow only ~5 orderCreate calls/minute, so
 * creates are throttled conservatively.
 */

import { groupRecords } from "../assemble.js";
import { buildOrderInput } from "./orderInput.js";
import { COMMAND } from "../command.js";

const ORDER_CREATE = `#graphql
  mutation CreateOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message }
    }
  }
`;

const ORDER_UPDATE = `#graphql
  mutation UpdateOrder($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id }
      userErrors { field message }
    }
  }
`;

const ORDER_DELETE = `#graphql
  mutation DeleteOrder($orderId: ID!) {
    orderDelete(orderId: $orderId) {
      deletedId
      userErrors { field message }
    }
  }
`;

// Don't email the customer for imported/back-filled orders, and don't let an
// import move real inventory.
const CREATE_OPTIONS = { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: "BYPASS" };

/**
 * @param {object[]} rows - header-normalized, validated order rows
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} admin
 * @returns {Promise<{ created: number, updated: number, deleted: number, skipped: number, errors: object[] }>}
 */
export async function upsertOrders(rows, admin, { onProgress } = {}) {
  const groups = groupRecords(rows);
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [], results: new Array(groups.length) };

  // Small batches with a pause — respects the dev-store ~5 creates/minute cap
  // better than a wide fan-out while still overlapping network latency.
  let base = 0;
  for (const batch of chunk(groups, 5)) {
    const start = base;
    await Promise.all(batch.map((group, k) =>
      writeGroup(group, admin, result).then((o) => { result.results[start + k] = o; })
    ));
    base += batch.length;
    onProgress?.(batch.length);
    await sleep(250);
  }
  return result;
}

async function writeGroup(group, admin, result) {
  let built;
  try {
    built = buildOrderInput(group);
  } catch (err) {
    result.errors.push({ order: group[0]?.order_name ?? "", message: err.message });
    return { status: "failed", comment: err.message };
  }
  const { command, orderId, create, update } = built;
  const label = create.name || orderId || create.email || "(unknown)";

  try {
    if (command === COMMAND.IGNORE) { result.skipped++; return { status: "skipped", comment: "Ignored (Command)" }; }

    if (command === COMMAND.DELETE) {
      if (!orderId) { result.skipped++; return { status: "skipped", comment: "No matching order to delete" }; }
      const errs = await run(admin, ORDER_DELETE, { orderId }, "orderDelete");
      if (errs.length) { result.errors.push({ order: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }
      result.deleted++;
      return { status: "deleted", comment: "" };
    }

    // Existing order + non-NEW command → limited orderUpdate.
    if (orderId && command !== COMMAND.NEW) {
      const errs = await run(admin, ORDER_UPDATE, { input: update }, "orderUpdate");
      if (errs.length) { result.errors.push({ order: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }
      result.updated++;
      return { status: "updated", comment: "" };
    }

    // UPDATE/REPLACE with no existing order can't create — skip.
    if (command === COMMAND.UPDATE || command === COMMAND.REPLACE) {
      result.skipped++;
      return { status: "skipped", comment: "No matching order to update" };
    }

    const errs = await run(admin, ORDER_CREATE, { order: create, options: CREATE_OPTIONS }, "orderCreate");
    if (errs.length) { result.errors.push({ order: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }
    result.created++;
    return { status: "created", comment: "" };
  } catch (err) {
    result.errors.push({ order: label, message: err.message });
    return { status: "failed", comment: err.message };
  }
}

/** Join userError messages into one comment string. */
function msgs(errs) {
  return errs.map((e) => e.message).filter(Boolean).join("; ");
}

async function run(admin, mutation, variables, key) {
  const res = await admin.graphql(mutation, { variables });
  const { data } = await res.json();
  return data?.[key]?.userErrors ?? [];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
