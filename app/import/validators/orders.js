/**
 * import/validators/orders.js
 *
 * Record-aware validation for order imports. Rows arrive header-normalized and
 * are grouped into orders first (top_row on the first line-item row); each
 * order is validated as a whole. Valid rows pass through UNCHANGED — the order
 * input builder does its own coercion.
 *
 * Command drives the requirements:
 *   - DELETE needs only an order id.
 *   - NEW / create (no id) needs at least one line item.
 *   - MERGE/UPDATE on an existing order is a light field update.
 */

import { groupRecords, topRow } from "../assemble.js";
import { parseCommand, COMMAND } from "../command.js";

const VALID_FINANCIAL = new Set([
  "PENDING", "AUTHORIZED", "PARTIALLY_PAID", "PAID", "EXPIRED",
  "PARTIALLY_REFUNDED", "REFUNDED", "VOIDED",
]);

/**
 * @param {object[]} rows - header-normalized rows
 * @returns {{ valid: object[], errors: Array<{ row: number, field: string, message: string }> }}
 */
export function validateOrderRows(rows) {
  const valid = [];
  const errors = [];

  let rowNum = 2; // row 1 is the header
  for (const group of groupRecords(rows)) {
    const top = topRow(group);
    const e = [];

    let command;
    try {
      command = parseCommand(top.command);
    } catch (err) {
      e.push({ row: rowNum, field: "command", message: err.message });
    }

    const hasId = Boolean(str(top.order_id));

    if (command === COMMAND.DELETE) {
      if (!hasId) e.push({ row: rowNum, field: "order_id", message: "DELETE needs an order ID" });
    } else if (command !== COMMAND.IGNORE) {
      const isCreate = !hasId || command === COMMAND.NEW;

      if (isCreate) {
        const lineItems = group.filter((r) => (r.line_type || "Line Item") === "Line Item")
          .filter((r) => str(r.line_item_variant_id) || str(r.line_item_title) || str(r.line_item_name));
        if (lineItems.length === 0) {
          e.push({ row: rowNum, field: "line_item_title", message: "New order needs at least one line item (variant ID or title)" });
        }
      }

      if (str(top.financial_status) && !VALID_FINANCIAL.has(str(top.financial_status).toUpperCase())) {
        e.push({ row: rowNum, field: "financial_status", message: `Invalid financial status "${top.financial_status}"` });
      }
      if (str(top.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(top.email))) {
        e.push({ row: rowNum, field: "email", message: `Invalid email "${top.email}"` });
      }

      group.forEach((row, i) => {
        const rn = rowNum + i;
        integer(row.line_item_quantity, "line_item_quantity", rn, e);
        numeric(row.line_item_price, "line_item_price", rn, e);
        numeric(row.transaction_amount, "transaction_amount", rn, e);
      });
    }

    if (e.length) errors.push(...e);
    else valid.push(...group);

    rowNum += group.length;
  }

  return { valid, errors };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function str(v) {
  return String(v ?? "").trim();
}

function numeric(value, field, row, errors) {
  const s = str(value);
  if (s !== "" && Number.isNaN(Number(s))) {
    errors.push({ row, field, message: `${field} must be a number, got "${value}"` });
  }
}

function integer(value, field, row, errors) {
  const s = str(value);
  if (s !== "" && !Number.isInteger(Number(s))) {
    errors.push({ row, field, message: `${field} must be a whole number, got "${value}"` });
  }
}
