/**
 * import/writers/customerInput.js
 *
 * Pure transform: a customer's assembled row group (one row per customer, the
 * default address inlined — the shape export/normalizer.js normalizeCustomer
 * produces) → the customerSet input + identifier, plus the marketing-consent
 * values (which customerSet can't take — they have their own mutations).
 *
 * Schema-validated against Admin API 2026-07. customerSet upserts by
 * id/email/phone and manages addresses as a list field, exactly the
 * Matrixify-style whole-customer sync we want.
 */

import { COMMAND, parseCommand } from "../command.js";
import { topRow } from "../assemble.js";

// Only these marketing states are settable via the consent mutations
// (NOT_SUBSCRIBED / REDACTED / INVALID are read-only).
const MARKETING_STATES = new Set(["SUBSCRIBED", "UNSUBSCRIBED", "PENDING"]);

const clean = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : s;
};
const truthy = (v) => ["true", "1", "yes", "y", "x"].includes(String(v ?? "").trim().toLowerCase());
const toGid = (type, id) => {
  const s = clean(id);
  return s === undefined ? undefined : s.startsWith("gid://") ? s : `gid://shopify/${type}/${s}`;
};

/** Build a MailingAddressInput from the row's default-address columns. */
function buildAddress(row) {
  const a = {};
  const map = {
    firstName: "address_first_name", lastName: "address_last_name",
    company: "address_company", phone: "address_phone",
    address1: "address1", address2: "address2", city: "address_city",
    provinceCode: "address_province_code", countryCode: "address_country_code",
    zip: "address_zip",
  };
  for (const [field, key] of Object.entries(map)) {
    if (clean(row[key]) !== undefined) a[field] = clean(row[key]);
  }
  return Object.keys(a).length ? a : null;
}

/** A consent object for the marketing mutations, or null when not settable. */
function consent(state, optIn) {
  const s = clean(state)?.toUpperCase();
  if (!s || !MARKETING_STATES.has(s)) return null;
  const c = { marketingState: s };
  const lvl = clean(optIn)?.toUpperCase();
  if (lvl) c.marketingOptInLevel = lvl;
  return c;
}

/**
 * @param {object[]} group - assembled rows for one customer
 * @returns {{ command: string, identifier: object|undefined, input: object,
 *            emailConsent: object|null, smsConsent: object|null }}
 */
export function buildCustomerInput(group) {
  const top = topRow(group);
  const command = parseCommand(top.command);

  const input = {};
  if (clean(top.email) !== undefined) input.email = clean(top.email);
  if (clean(top.first_name) !== undefined) input.firstName = clean(top.first_name);
  if (clean(top.last_name) !== undefined) input.lastName = clean(top.last_name);
  if (clean(top.phone) !== undefined) input.phone = clean(top.phone);
  if (clean(top.note) !== undefined) input.note = clean(top.note);
  if (clean(top.locale) !== undefined) input.locale = clean(top.locale);
  if (clean(top.tax_exempt) !== undefined) input.taxExempt = truthy(top.tax_exempt);
  if (clean(top.tags) !== undefined) {
    input.tags = clean(top.tags) ? clean(top.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
  }
  const address = buildAddress(top);
  if (address) input.addresses = [address];

  // identifier: prefer id, else email. NEW always creates (no identifier).
  let identifier;
  if (command !== COMMAND.NEW) {
    if (clean(top.customer_id)) identifier = { id: toGid("Customer", top.customer_id) };
    else if (clean(top.email)) identifier = { email: clean(top.email) };
  }
  if (identifier?.id) input.id = identifier.id;

  return {
    command,
    identifier,
    input,
    emailConsent: consent(top.email_marketing_state, top.email_marketing_opt_in),
    // SMS consent needs a phone on the customer.
    smsConsent: clean(top.phone) ? consent(top.sms_marketing_state, top.sms_marketing_opt_in) : null,
  };
}
