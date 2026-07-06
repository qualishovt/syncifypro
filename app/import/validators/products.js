/**
 * import/validators/products.js
 *
 * Record-aware validation for product imports. Rows arrive header-normalized
 * (snake_case keys) and are grouped into products first, so a product is
 * validated as a whole rather than as orphaned variant rows — dropping a lone
 * variant row would silently mutilate the product.
 *
 * Valid rows are returned UNCHANGED (still strings): the productSet input
 * builder does its own coercion, so the validator's job is to reject bad
 * records and report why, not to transform.
 */

import { groupRecords, topRow } from "../assemble.js";
import { parseCommand, COMMAND } from "../command.js";

const VALID_STATUSES = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);

/**
 * @param {object[]} rows - header-normalized rows
 * @returns {{ valid: object[], errors: Array<{ row: number, field: string, message: string }> }}
 */
export function validateProductRows(rows) {
  const valid = [];
  const errors = [];

  let rowNum = 2; // row 1 is the header
  for (const group of groupRecords(rows)) {
    const top = topRow(group);
    const groupErrors = [];

    // ── Command ──────────────────────────────────────────────────
    let command;
    try {
      command = parseCommand(top.command);
    } catch (err) {
      groupErrors.push({ row: rowNum, field: "command", message: err.message });
    }

    const hasIdentity = Boolean(str(top.product_id) || str(top.handle));

    if (command === COMMAND.DELETE) {
      // Delete only needs to identify the product.
      if (!hasIdentity) {
        groupErrors.push({ row: rowNum, field: "product_id", message: "DELETE needs a product ID or handle" });
      }
    } else if (command !== COMMAND.IGNORE) {
      // Create/update: need a title (to create) or an identity (to update).
      if (!str(top.title) && !hasIdentity) {
        groupErrors.push({ row: rowNum, field: "title", message: "Product needs a title, or an ID/handle to update" });
      }
      if (str(top.status) && !VALID_STATUSES.has(str(top.status).toUpperCase())) {
        groupErrors.push({ row: rowNum, field: "status", message: `Invalid status "${top.status}" (ACTIVE, DRAFT, ARCHIVED)` });
      }
      // Numeric checks across every variant row of the record.
      group.forEach((row, i) => {
        const rn = rowNum + i;
        numeric(row.price, "price", rn, groupErrors);
        numeric(row.compare_at_price, "compare_at_price", rn, groupErrors);
        numeric(row.weight, "weight", rn, groupErrors);
        integer(row.inventory_qty, "inventory_qty", rn, groupErrors);
      });
    }

    if (groupErrors.length) errors.push(...groupErrors);
    else valid.push(...group);

    rowNum += group.length;
  }

  return { valid, errors };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function str(v) {
  const s = String(v ?? "").trim();
  return s === "" ? "" : s;
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
