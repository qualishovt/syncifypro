/**
 * import/writers/upsertDiscounts.js
 *
 * Creates / updates / deletes basic code discounts from validated rows — the
 * shape a WooCommerce coupon migrates to (a code + a percentage or fixed
 * amount, optional dates / usage limit / minimum requirement).
 *
 * Per row: DELETE → discountCodeDelete; existing (by discount_id or code
 * lookup) → discountCodeBasicUpdate; otherwise → discountCodeBasicCreate.
 * Requires write_discounts.
 */

const CREATE = `#graphql
  mutation CreateDiscount($in: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $in) { codeDiscountNode { id } userErrors { field message } }
  }`;
const UPDATE = `#graphql
  mutation UpdateDiscount($id: ID!, $in: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $in) { userErrors { field message } }
  }`;
const DELETE = `#graphql
  mutation DeleteDiscount($id: ID!) {
    discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } }
  }`;
const FIND = `#graphql
  query FindDiscount($code: String!) { codeDiscountNodeByCode(code: $code) { id } }`;

export async function upsertDiscounts(rows, admin, { onProgress } = {}) {
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [], results: new Array(rows.length) };

  let base = 0;
  for (const batch of chunk(rows, 10)) {
    const start = base;
    await Promise.all(batch.map((row, k) =>
      writeRow(row, admin, result).then((o) => { result.results[start + k] = o; onProgress?.(1); })));
    base += batch.length;
    await sleep(20);
  }
  return result;
}

async function writeRow(row, admin, result) {
  const code = str(row.codes) || str(row.code);
  const label = code || row.title || row.discount_id || "(discount)";
  const command = (row.command || "").trim().toUpperCase() || "MERGE";
  try {
    const existingId = await resolveId(row, admin, code);

    if (command === "DELETE") {
      if (!existingId) { result.skipped++; return { status: "skipped", comment: "No matching discount to delete" }; }
      const ue = await run(admin, DELETE, { id: existingId }, "discountCodeDelete");
      if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
      result.deleted++;
      return { status: "deleted", comment: "" };
    }

    const input = discountInput(row, code);
    if (existingId) {
      const ue = await run(admin, UPDATE, { id: existingId, in: input }, "discountCodeBasicUpdate");
      if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
      result.updated++;
      return { status: "updated", comment: "" };
    }
    const ue = await run(admin, CREATE, { in: input }, "discountCodeBasicCreate");
    if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
    result.created++;
    return { status: "created", comment: "" };
  } catch (err) {
    result.errors.push({ path: label, message: err.message });
    return { status: "failed", comment: err.message };
  }
}

async function resolveId(row, admin, code) {
  if (row.discount_id) return `gid://shopify/DiscountCodeNode/${String(row.discount_id).replace(/\D/g, "")}`;
  if (!code) return null;
  const res = await admin.graphql(FIND, { variables: { code } });
  const { data } = await res.json();
  return data?.codeDiscountNodeByCode?.id ?? null;
}

function discountInput(row, code) {
  const vt = str(row.value_type).toLowerCase();
  const num = Number(str(row.value) || 0);
  // Shopify percentage is a 0–1 fraction; migrations pass whole percents (10 → 0.1).
  const value = vt === "fixed_amount"
    ? { discountAmount: { amount: String(Math.abs(num)), appliesOnEachItem: false } }
    : { percentage: num > 1 ? num / 100 : num };

  const input = {
    title: str(row.title) || code,
    code,
    customerSelection: { all: true },
    customerGets: { value, items: { all: true } },
  };
  // Shopify requires startsAt on create ("Starts at can't be blank") —
  // default to now so a minimal file (code + value) imports cleanly.
  input.startsAt = str(row.starts_at) ? iso(row.starts_at) : new Date().toISOString();
  if (str(row.ends_at)) input.endsAt = iso(row.ends_at);
  if (str(row.usage_limit) && Number.isInteger(Number(row.usage_limit))) input.usageLimit = Number(row.usage_limit);
  if (truthy(row.once_per_customer)) input.appliesOncePerCustomer = true;
  if (str(row.minimum_subtotal)) {
    input.minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: String(row.minimum_subtotal) } };
  } else if (str(row.minimum_quantity)) {
    input.minimumRequirement = { quantity: { greaterThanOrEqualToQuantity: String(row.minimum_quantity) } };
  }
  return input;
}

function iso(v) {
  const s = str(v);
  // Accept a date or datetime; append time/zone so Shopify gets a full ISO string.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s;
}
function truthy(v) { return ["true", "yes", "1"].includes(str(v).toLowerCase()); }
function msgs(errs) { return errs.map((e) => e.message).filter(Boolean).join("; "); }
function str(v) { return String(v ?? "").trim(); }

async function run(admin, mutation, variables, field) {
  const res = await admin.graphql(mutation, { variables });
  const { data } = await res.json();
  return data?.[field]?.userErrors ?? [];
}
function chunk(arr, size) { const r = []; for (let i = 0; i < arr.length; i += size) r.push(arr.slice(i, i + size)); return r; }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
