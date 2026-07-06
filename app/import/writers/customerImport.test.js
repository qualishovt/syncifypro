/**
 * import/writers/customerImport.test.js
 *
 * Proves the customers import vertical: a customer row (with inlined default
 * address) → customerSet input, Command dispatch, record-aware validation, and
 * a full export→CSV→import round-trip. Run with `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toCSV } from "../../export/formats/csv.js";
import { CUSTOMER_FIELDS } from "../../export/fieldLists.js";
import { parseCSV } from "../parsers/csv.js";
import { normalizeHeaders } from "../headers.js";
import { groupRecords } from "../assemble.js";
import { COMMAND } from "../command.js";
import { validateCustomerRows } from "../validators/customers.js";
import { buildCustomerInput } from "./customerInput.js";

function customerRow(overrides = {}) {
  return {
    command: "", customer_id: "99", email: "jane@example.com",
    first_name: "Jane", last_name: "Doe", phone: "+15551234567",
    locale: "en", tax_exempt: "false", tags: "vip, wholesale", note: "VIP",
    email_marketing_state: "SUBSCRIBED", email_marketing_opt_in: "SINGLE_OPT_IN",
    sms_marketing_state: "NOT_SUBSCRIBED",
    address_first_name: "Jane", address_last_name: "Doe", address_company: "Acme",
    address1: "150 Elgin St", address2: "Suite 800", address_city: "Ottawa",
    address_province_code: "ON", address_country_code: "CA", address_zip: "K2P 1L4",
    address_phone: "+15551234567",
    ...overrides,
  };
}

test("buildCustomerInput maps a customer + default address", () => {
  const { command, identifier, input, emailConsent, smsConsent } = buildCustomerInput([customerRow()]);

  assert.equal(command, COMMAND.MERGE);
  assert.deepEqual(identifier, { id: "gid://shopify/Customer/99" });
  assert.equal(input.id, "gid://shopify/Customer/99");
  assert.equal(input.email, "jane@example.com");
  assert.equal(input.firstName, "Jane");
  assert.deepEqual(input.tags, ["vip", "wholesale"]);
  assert.equal(input.taxExempt, false);

  assert.equal(input.addresses.length, 1);
  assert.deepEqual(input.addresses[0], {
    firstName: "Jane", lastName: "Doe", company: "Acme",
    phone: "+15551234567", address1: "150 Elgin St", address2: "Suite 800",
    city: "Ottawa", provinceCode: "ON", countryCode: "CA", zip: "K2P 1L4",
  });

  // email consent extracted; SMS "NOT_SUBSCRIBED" is not settable → null
  assert.deepEqual(emailConsent, { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" });
  assert.equal(smsConsent, null);
});

test("Command dispatch: NEW omits identifier and input.id", () => {
  const asNew = buildCustomerInput([customerRow({ command: "NEW" })]);
  assert.equal(asNew.command, COMMAND.NEW);
  assert.equal(asNew.identifier, undefined);
  assert.equal(asNew.input.id, undefined);
});

test("builder falls back to email identifier when no id", () => {
  const { identifier, input } = buildCustomerInput([customerRow({ customer_id: "" })]);
  assert.deepEqual(identifier, { email: "jane@example.com" });
  assert.equal(input.id, undefined);
});

test("settable SMS consent is extracted when phone present", () => {
  const { smsConsent } = buildCustomerInput([customerRow({ sms_marketing_state: "SUBSCRIBED", sms_marketing_opt_in: "SINGLE_OPT_IN" })]);
  assert.deepEqual(smsConsent, { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" });
});

test("validator: valid customer passes", () => {
  const { valid, errors } = validateCustomerRows([customerRow()]);
  assert.equal(errors.length, 0);
  assert.equal(valid.length, 1);
});

test("validator: create with no email and no id is rejected", () => {
  const { errors } = validateCustomerRows([customerRow({ email: "", customer_id: "" })]);
  assert.ok(errors.some((e) => e.field === "email"));
});

test("validator: invalid email is rejected", () => {
  const { errors } = validateCustomerRows([customerRow({ email: "not-an-email" })]);
  assert.ok(errors.some((e) => e.field === "email"));
});

test("validator: DELETE with neither id nor email is rejected", () => {
  const { errors } = validateCustomerRows([{ command: "DELETE", customer_id: "", email: "" }]);
  assert.ok(errors.some((e) => e.message.includes("DELETE")));
});

test("full round-trip: export row → CSV → import → customerSet input", () => {
  const csv = toCSV([customerRow()], CUSTOMER_FIELDS);       // humanized headers
  const rows = normalizeHeaders(parseCSV(csv), "customers"); // back to snake_case

  const { valid, errors } = validateCustomerRows(rows);
  assert.equal(errors.length, 0, JSON.stringify(errors));

  const groups = groupRecords(valid);
  assert.equal(groups.length, 1);
  const { input } = buildCustomerInput(groups[0]);
  assert.equal(input.email, "jane@example.com");
  assert.equal(input.addresses[0].city, "Ottawa");
});
