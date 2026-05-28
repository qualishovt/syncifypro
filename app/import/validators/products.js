/**
 * import/validators/products.js
 *
 * Validates parsed CSV rows before they're sent to Shopify.
 * Returns { valid: [], errors: [] } so the caller can decide
 * whether to abort or import valid rows and report the bad ones.
 *
 * Swap the manual checks here for zod if you prefer schema-first:
 *   import { z } from "zod";
 */

const REQUIRED_FIELDS = ["title"];
const VALID_STATUSES  = ["ACTIVE", "DRAFT", "ARCHIVED"];

/**
 * @param {object[]} rows - parsed CSV rows (raw strings)
 * @returns {{ valid: object[], errors: Array<{ row: number, field: string, message: string }> }}
 */
export function validateProductRows(rows) {
  const valid  = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +2 because row 1 is the header
    const rowErrors = [];

    // ── Required fields ──────────────────────────────────────────
    for (const field of REQUIRED_FIELDS) {
      if (!row[field]?.trim()) {
        rowErrors.push({ row: rowNum, field, message: `"${field}" is required` });
      }
    }

    // ── Status ───────────────────────────────────────────────────
    if (row.status && !VALID_STATUSES.includes(row.status.toUpperCase())) {
      rowErrors.push({
        row: rowNum,
        field: "status",
        message: `Invalid status "${row.status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    // ── Price ────────────────────────────────────────────────────
    if (row.price && isNaN(parseFloat(row.price))) {
      rowErrors.push({ row: rowNum, field: "price", message: `Price must be a number, got "${row.price}"` });
    }

    if (row.compare_at_price && isNaN(parseFloat(row.compare_at_price))) {
      rowErrors.push({ row: rowNum, field: "compare_at_price", message: "Compare-at price must be a number" });
    }

    // ── Inventory ────────────────────────────────────────────────
    if (row.inventory_qty !== "" && !Number.isInteger(Number(row.inventory_qty))) {
      rowErrors.push({ row: rowNum, field: "inventory_qty", message: "Inventory quantity must be a whole number" });
    }

    // ── Weight ───────────────────────────────────────────────────
    if (row.weight && isNaN(parseFloat(row.weight))) {
      rowErrors.push({ row: rowNum, field: "weight", message: "Weight must be a number" });
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

/** Coerce string values to the right types after validation passes */
function coerce(row) {
  return {
    ...row,
    status:          row.status?.toUpperCase() || "DRAFT",
    price:           row.price           ? parseFloat(row.price)           : undefined,
    compare_at_price: row.compare_at_price ? parseFloat(row.compare_at_price) : undefined,
    inventory_qty:   row.inventory_qty   ? parseInt(row.inventory_qty, 10) : undefined,
    weight:          row.weight          ? parseFloat(row.weight)          : undefined,
    taxable:         row.taxable === "true" || row.taxable === "TRUE",
    tags:            row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
  };
}