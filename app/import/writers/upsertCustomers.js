/**
 * import/writers/upsertCustomers.js
 *
 * Creates / updates / deletes customers from validated rows.
 * command DELETE → customerDelete; a customer_id (or UPDATE) → customerUpdate;
 * otherwise → customerCreate. The default address is not imported (Shopify
 * deprecated CustomerInput.addresses). Requires write_customers.
 */

const CREATE = `#graphql
  mutation CustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) { customer { id } userErrors { field message } }
  }
`;
const UPDATE = `#graphql
  mutation CustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) { customer { id } userErrors { field message } }
  }
`;
const DELETE = `#graphql
  mutation CustomerDelete($input: CustomerDeleteInput!) {
    customerDelete(input: $input) { deletedCustomerId userErrors { field message } }
  }
`;

export async function upsertCustomers(rows, admin) {
  let created = 0, updated = 0;
  const errors = [];

  for (const batch of chunk(rows, 10)) {
    await Promise.all(batch.map(async (row) => {
      const gid = row.customer_id ? `gid://shopify/Customer/${row.customer_id}` : null;
      const tag = row.email || row.customer_id;
      try {
        if (row.command === "DELETE") {
          const ue = await run(admin, DELETE, { input: { id: gid } }, "customerDelete");
          if (ue.length) errors.push({ customer: tag, userErrors: ue }); else updated++;
        } else if (gid) {
          const ue = await run(admin, UPDATE, { input: buildInput(row, gid) }, "customerUpdate");
          if (ue.length) errors.push({ customer: tag, userErrors: ue }); else updated++;
        } else {
          const ue = await run(admin, CREATE, { input: buildInput(row, null) }, "customerCreate");
          if (ue.length) errors.push({ customer: tag, userErrors: ue }); else created++;
        }
      } catch (err) {
        errors.push({ customer: tag, message: err.message });
      }
    }));
    await sleep(50);
  }

  return { created, updated, errors };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function buildInput(row, gid) {
  const input = {};
  if (gid) input.id = gid;
  if (row.email)      input.email     = row.email;
  if (row.first_name) input.firstName = row.first_name;
  if (row.last_name)  input.lastName  = row.last_name;
  if (row.phone)      input.phone     = row.phone;
  if (row.locale)     input.locale    = row.locale;
  if (row.note)       input.note      = row.note;
  if (row.tax_exempt) input.taxExempt = true;
  if (row.tags?.length) input.tags    = row.tags;
  if (row.email_marketing_state) {
    input.emailMarketingConsent = { marketingState: row.email_marketing_state };
  }
  return input;
}

async function run(admin, mutation, variables, field) {
  const res = await admin.graphql(mutation, { variables });
  const { data } = await res.json();
  return data?.[field]?.userErrors ?? [];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
