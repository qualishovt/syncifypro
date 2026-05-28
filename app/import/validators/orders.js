/**
 * import/validators/orders.js
 *
 * Validates parsed order CSV rows before they're sent to Shopify.
 * Returns { valid: [], errors: [] }.
 *
 * Note: Shopify's Admin API does not allow creating orders via
 * orderCreate in most flows — it's typically used for draft orders
 * or order editing. This validator reflects that: it's designed
 * for updating existing orders (add note, tags, cancel reason etc.)
 * rather than creating new ones from scratch.
 */

const VALID_FINANCIAL_STATUSES = [
  "PENDING", "AUTHORIZED", "PARTIALLY_PAID", "PAID", "EXPIRED",
  "PARTIALLY_REFUNDED", "REFUNDED", "VOIDED",
];

const VALID_CANCEL_REASONS = [
  "CUSTOMER", "FRAUD", "INVENTORY", "DECLINED", "OTHER", "",
];

/**
 * @param {object[]} rows - parsed CSV rows (raw strings)
 * @returns {{ valid: object[], errors: Array<{ row: number, field: string, message: string }> }}
 */
export function validateOrderRows(rows) {
  const valid  = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +2 because row 1 is header
    const rowErrors = [];

    // ── order_id required for updates ────────────────────────────
    if (!row.order_id?.trim()) {
      rowErrors.push({ row: rowNum, field: "order_id", message: '"order_id" is required' });
    }

    // ── financial_status ──────────────────────────────────────────
    if (row.financial_status && !VALID_FINANCIAL_STATUSES.includes(row.financial_status.toUpperCase())) {
      rowErrors.push({
        row: rowNum,
        field: "financial_status",
        message: `Invalid financial status "${row.financial_status}". Must be one of: ${VALID_FINANCIAL_STATUSES.join(", ")}`,
      });
    }

    // ── cancel_reason ─────────────────────────────────────────────
    if (row.cancel_reason && !VALID_CANCEL_REASONS.includes(row.cancel_reason.toUpperCase())) {
      rowErrors.push({
        row: rowNum,
        field: "cancel_reason",
        message: `Invalid cancel reason "${row.cancel_reason}". Must be one of: ${VALID_CANCEL_REASONS.filter(Boolean).join(", ")}`,
      });
    }

    // ── email format ─────────────────────────────────────────────
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      rowErrors.push({ row: rowNum, field: "email", message: `Invalid email address "${row.email}"` });
    }

    // ── line item quantity ────────────────────────────────────────
    if (row.line_item_quantity !== "" && !Number.isInteger(Number(row.line_item_quantity))) {
      rowErrors.push({ row: rowNum, field: "line_item_quantity", message: "Line item quantity must be a whole number" });
    }

    // ── line item price ───────────────────────────────────────────
    if (row.line_item_price && isNaN(parseFloat(row.line_item_price))) {
      rowErrors.push({ row: rowNum, field: "line_item_price", message: "Line item price must be a number" });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      valid.push(coerce(row));
    }
  });

  return { valid, errors };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function coerce(row) {
  return {
    ...row,
    financial_status:    row.financial_status?.toUpperCase() || undefined,
    cancel_reason:       row.cancel_reason?.toUpperCase()    || undefined,
    tags:                row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    line_item_quantity:  row.line_item_quantity ? parseInt(row.line_item_quantity, 10) : undefined,
    line_item_price:     row.line_item_price    ? parseFloat(row.line_item_price)      : undefined,
    line_item_taxable:   row.line_item_taxable === "true" || row.line_item_taxable === "TRUE",
  };
}