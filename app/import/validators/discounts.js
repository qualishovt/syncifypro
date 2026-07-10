/**
 * import/validators/discounts.js
 *
 * Validates parsed discount rows (one row per discount). Command drives the
 * requirements:
 *   - DELETE needs a discount_id or code.
 *   - Create/update needs a code (to create) or an ID (to update).
 * value_type must be percentage|fixed_amount; value must be numeric.
 */

const VALUE_TYPES = new Set(["percentage", "fixed_amount"]);

export function validateDiscountRows(rows) {
  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const e = [];
    const command = (row.command || "").trim().toUpperCase() || "MERGE";
    const code = str(row.codes) || str(row.code);
    const hasIdentity = Boolean(str(row.discount_id) || code);

    if (command === "DELETE") {
      if (!hasIdentity) e.push({ row: rowNum, field: "discount_id", message: "DELETE needs a discount ID or code" });
    } else if (command !== "IGNORE") {
      if (!code && !str(row.discount_id)) {
        e.push({ row: rowNum, field: "codes", message: "Discount needs a code, or an ID to update" });
      }
      const vt = str(row.value_type).toLowerCase();
      if (vt && !VALUE_TYPES.has(vt)) {
        e.push({ row: rowNum, field: "value_type", message: `Invalid value_type "${row.value_type}" (percentage or fixed_amount)` });
      }
      const v = str(row.value);
      if (v && Number.isNaN(Number(v))) {
        e.push({ row: rowNum, field: "value", message: `value must be a number` });
      }
    }

    if (e.length) errors.push(...e);
    else if (command !== "IGNORE") valid.push(row);
  });

  return { valid, errors };
}

function str(v) {
  return String(v ?? "").trim();
}
