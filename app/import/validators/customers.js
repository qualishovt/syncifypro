/**
 * import/validators/customers.js
 *
 * Validates parsed customer rows. Returns { valid, errors }.
 * NEW/UPDATE/MERGE need an email (or customer_id for updates); DELETE needs
 * customer_id. Note: the default address is NOT imported (Shopify deprecated
 * CustomerInput.addresses — needs the dedicated address mutations).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MARKETING_STATES = ["SUBSCRIBED", "NOT_SUBSCRIBED", "PENDING", "UNSUBSCRIBED", "REDACTED", ""];

export function validateCustomerRows(rows) {
  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const rowErrors = [];
    const command = (row.command || "").trim().toUpperCase() || (row.customer_id?.trim() ? "UPDATE" : "NEW");

    if (command === "IGNORE") return;

    if (command === "DELETE") {
      if (!row.customer_id?.trim()) {
        rowErrors.push({ row: rowNum, field: "customer_id", message: '"customer_id" is required to DELETE' });
      }
    } else {
      if (!row.customer_id?.trim() && !row.email?.trim()) {
        rowErrors.push({ row: rowNum, field: "email", message: "Either email or customer_id is required" });
      }
      if (row.email && !EMAIL_RE.test(row.email)) {
        rowErrors.push({ row: rowNum, field: "email", message: `Invalid email "${row.email}"` });
      }
      if (row.email_marketing_state && !MARKETING_STATES.includes(row.email_marketing_state.toUpperCase())) {
        rowErrors.push({ row: rowNum, field: "email_marketing_state", message: `Invalid email marketing state "${row.email_marketing_state}"` });
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
    } else {
      valid.push({
        command,
        customer_id: row.customer_id?.trim() || "",
        email:       row.email?.trim() || "",
        first_name:  row.first_name?.trim() || "",
        last_name:   row.last_name?.trim() || "",
        phone:       row.phone?.trim() || "",
        locale:      row.locale?.trim() || "",
        note:        row.note?.trim() || "",
        tax_exempt:  /^(true|yes|1)$/i.test(row.tax_exempt || ""),
        tags:        row.tags ? row.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        email_marketing_state: row.email_marketing_state?.trim().toUpperCase() || "",
      });
    }
  });

  return { valid, errors };
}
