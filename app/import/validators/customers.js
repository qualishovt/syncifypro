/**
 * import/validators/customers.js
 *
 * Record-aware validation for customer imports. Rows arrive header-normalized;
 * each customer is one record (default address inlined). Valid rows pass
 * through UNCHANGED — the customerSet input builder does its own coercion.
 *
 * Command drives the requirements:
 *   - DELETE needs a customer id or email (to look one up).
 *   - Create/update needs an email (customerSet upserts/creates by email) or an
 *     existing id.
 */

import { groupRecords, topRow } from "../assemble.js";
import { parseCommand, COMMAND } from "../command.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object[]} rows - header-normalized rows
 * @returns {{ valid: object[], errors: Array<{ row: number, field: string, message: string }> }}
 */
export function validateCustomerRows(rows) {
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

    const hasId = Boolean(str(top.customer_id));
    const email = str(top.email);

    if (command === COMMAND.DELETE) {
      if (!hasId && !email) {
        e.push({ row: rowNum, field: "customer_id", message: "DELETE needs a customer ID or email" });
      }
    } else if (command !== COMMAND.IGNORE) {
      if (!email && !hasId) {
        e.push({ row: rowNum, field: "email", message: "Customer needs an email, or an ID to update" });
      }
      if (email && !EMAIL_RE.test(email)) {
        e.push({ row: rowNum, field: "email", message: `Invalid email "${top.email}"` });
      }
    }

    if (e.length) errors.push(...e);
    else valid.push(...group);

    rowNum += group.length;
  }

  return { valid, errors };
}

function str(v) {
  return String(v ?? "").trim();
}
