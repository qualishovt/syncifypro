/**
 * import/writers/upsertCustomers.js
 *
 * Writes validated customer rows to Shopify, on the import foundation:
 *   groupRecords()      → one record per customer (default address inlined)
 *   buildCustomerInput  → schema-valid customerSet input + identifier
 *   Command             → MERGE/UPDATE/NEW/REPLACE/DELETE/IGNORE dispatch
 *
 * customerSet upserts by id/email/phone and manages addresses as a list field.
 * Marketing consent isn't part of CustomerSetInput, so it's applied as a
 * follow-up via the dedicated consent mutations (best-effort; needs the
 * customer id from the customerSet response). Requires write_customers.
 */

import { groupRecords } from "../assemble.js";
import { buildCustomerInput } from "./customerInput.js";
import { COMMAND } from "../command.js";

const CUSTOMER_SET = `#graphql
  mutation UpsertCustomer($input: CustomerSetInput!, $identifier: CustomerSetIdentifiers) {
    customerSet(input: $input, identifier: $identifier) {
      customer { id }
      userErrors { field message code }
    }
  }
`;

const CUSTOMER_DELETE = `#graphql
  mutation DeleteCustomer($input: CustomerDeleteInput!) {
    customerDelete(input: $input) { deletedCustomerId userErrors { field message } }
  }
`;

const CUSTOMER_BY_IDENTIFIER = `#graphql
  query CustomerByIdentifier($identifier: CustomerIdentifierInput!) {
    customerByIdentifier(identifier: $identifier) { id }
  }
`;

const EMAIL_CONSENT = `#graphql
  mutation EmailConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) { userErrors { field message } }
  }
`;

const SMS_CONSENT = `#graphql
  mutation SmsConsent($input: CustomerSmsMarketingConsentUpdateInput!) {
    customerSmsMarketingConsentUpdate(input: $input) { userErrors { field message } }
  }
`;

/**
 * @param {object[]} rows - header-normalized, validated customer rows
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} admin
 * @returns {Promise<{ created: number, updated: number, deleted: number, skipped: number, errors: object[] }>}
 */
export async function upsertCustomers(rows, admin, { onProgress } = {}) {
  const groups = groupRecords(rows);
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [], results: new Array(groups.length) };

  let base = 0;
  for (const batch of chunk(groups, 16)) {
    const start = base;
    await Promise.all(batch.map((group, k) =>
      writeGroup(group, admin, result).then((o) => { result.results[start + k] = o; onProgress?.(1); })
    ));
    base += batch.length;
    await sleep(20);
  }
  return result;
}

async function writeGroup(group, admin, result) {
  let built;
  try {
    built = buildCustomerInput(group);
  } catch (err) {
    result.errors.push({ customer: group[0]?.email ?? "", message: err.message });
    return { status: "failed", comment: err.message };
  }
  const { command, identifier, input, emailConsent, smsConsent } = built;
  const label = input.email || identifier?.id || "(unknown)";

  try {
    if (command === COMMAND.IGNORE) { result.skipped++; return { status: "skipped", comment: "Ignored (Command)" }; }

    if (command === COMMAND.DELETE) {
      const id = await resolveId(identifier, admin);
      if (!id) { result.skipped++; return { status: "skipped", comment: "No matching customer to delete" }; }
      const errs = await run(admin, CUSTOMER_DELETE, { input: { id } }, "customerDelete");
      if (errs.length) { result.errors.push({ customer: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }
      result.deleted++;
      return { status: "deleted", comment: "" };
    }

    if (command === COMMAND.UPDATE || command === COMMAND.REPLACE) {
      const id = await resolveId(identifier, admin);
      if (!id) { result.skipped++; return { status: "skipped", comment: "No matching customer to update" }; }
    }

    const existedBefore = Boolean(identifier);
    const res = await admin.graphql(CUSTOMER_SET, { variables: { input, identifier } });
    const payload = (await res.json())?.data?.customerSet;
    const errs = payload?.userErrors ?? [];
    if (errs.length) { result.errors.push({ customer: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }

    const customerId = payload?.customer?.id;
    existedBefore ? result.updated++ : result.created++;

    // Marketing consent — best-effort follow-ups.
    if (customerId && emailConsent) {
      const e = await run(admin, EMAIL_CONSENT, { input: { customerId, emailMarketingConsent: emailConsent } }, "customerEmailMarketingConsentUpdate");
      for (const err of e) result.errors.push({ customer: label, field: "email_marketing", message: err.message });
    }
    if (customerId && smsConsent) {
      const e = await run(admin, SMS_CONSENT, { input: { customerId, smsMarketingConsent: smsConsent } }, "customerSmsMarketingConsentUpdate");
      for (const err of e) result.errors.push({ customer: label, field: "sms_marketing", message: err.message });
    }
    return { status: existedBefore ? "updated" : "created", comment: "" };
  } catch (err) {
    result.errors.push({ customer: label, message: err.message });
    return { status: "failed", comment: err.message };
  }
}

/** Join userError messages into one comment string. */
function msgs(errs) {
  return errs.map((e) => e.message).filter(Boolean).join("; ");
}

/** Resolve an identifier ({id} or {email}) to a customer gid, or null. */
async function resolveId(identifier, admin) {
  if (!identifier) return null;
  if (identifier.id) return identifier.id;
  const res = await admin.graphql(CUSTOMER_BY_IDENTIFIER, {
    variables: { identifier: { emailAddress: identifier.email } },
  });
  return (await res.json())?.data?.customerByIdentifier?.id ?? null;
}

async function run(admin, mutation, variables, key) {
  const res = await admin.graphql(mutation, { variables });
  const { data } = await res.json();
  return data?.[key]?.userErrors ?? [];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
