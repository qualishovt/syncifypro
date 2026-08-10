/**
 * import/validators/giftCards.js
 *
 * Validates parsed gift-card rows. Returns { valid, errors }.
 * Commands: NEW/blank creates (needs initial_value); UPDATE edits note/
 * expiry (needs gift_card_id); DELETE deactivates (needs gift_card_id).
 * The full code can't be set or read via the API — Shopify generates it.
 */

export function validateGiftCardRows(rows) {
  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 header, +1 to 1-index
    const rowErrors = [];
    const id = String(row.gift_card_id ?? "").trim();
    const command = (row.command || "").trim().toUpperCase() || (id ? "UPDATE" : "NEW");

    if (command === "DELETE" || command === "UPDATE") {
      if (!id) {
        rowErrors.push({ row: rowNum, field: "gift_card_id", message: `"gift_card_id" is required to ${command} a gift card` });
      }
    } else if (command !== "IGNORE") {
      const value = Number(String(row.initial_value ?? "").trim());
      if (!Number.isFinite(value) || value <= 0) {
        rowErrors.push({ row: rowNum, field: "initial_value", message: '"initial_value" must be a positive amount to create a gift card' });
      }
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
    } else if (command !== "IGNORE") {
      valid.push({
        command,
        gift_card_id:   id,
        initial_value:  String(row.initial_value ?? "").trim(),
        note:           String(row.note ?? "").trim(),
        expires_on:     String(row.expires_on ?? "").trim(),
        customer_email: String(row.customer_email ?? "").trim(),
      });
    }
  });

  return { valid, errors };
}
