/**
 * import/writers/upsertProducts.js
 *
 * Writes validated product rows to Shopify. Rebuilt on the import foundation:
 *   groupRecords()       → one record per product (all its variant rows)
 *   buildProductSetInput → schema-valid productSet input + identifier
 *   Command              → MERGE/UPDATE/NEW/REPLACE/DELETE/IGNORE dispatch
 *
 * After the core productSet upsert, two follow-up passes bring the product to
 * full parity with what export emits:
 *   - per-location inventory  (productInventory.js, needs variant inventoryItem
 *     ids from the productSet response + a location-name→id map)
 *   - publication status      (the `published` column → publish/unpublish on
 *     the Online Store)
 *
 * All mutations are validated against Admin API 2026-07. Locations and the
 * Online Store publication id are resolved once per import run and cached.
 */

import { groupRecords, topRow } from "../assemble.js";
import { buildProductSetInput, isVariantRow } from "./productSetInput.js";
import { applyInventory, buildLocationMap } from "./productInventory.js";
import { COMMAND } from "../command.js";

const PRODUCT_SET = `#graphql
  mutation UpsertProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product {
        id handle title
        variants(first: 100) { nodes { id sku title inventoryItem { id } } }
      }
      userErrors { field message code }
    }
  }
`;

const PRODUCT_DELETE = `#graphql
  mutation DeleteProduct($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { field message } }
  }
`;

const PRODUCT_BY_IDENTIFIER = `#graphql
  query ProductByIdentifier($identifier: ProductIdentifierInput!) {
    productByIdentifier(identifier: $identifier) { id }
  }
`;

const PRODUCT_HANDLE = `#graphql
  query ProductHandle($id: ID!) { product(id: $id) { handle } }
`;
const REDIRECT_CREATE = `#graphql
  mutation RedirectCreate($redirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $redirect) {
      urlRedirect { id }
      userErrors { field message }
    }
  }
`;

const LOCATIONS = `#graphql
  query Locations { locations(first: 250, includeInactive: true) { nodes { id name } } }
`;
const PUBLICATIONS = `#graphql
  query Pubs { publications(first: 50) { nodes { id name } } }
`;
const PUBLISH = `#graphql
  mutation Pub($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }
`;
const UNPUBLISH = `#graphql
  mutation Unpub($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) { userErrors { field message } }
  }
`;

/**
 * Upsert validated product rows.
 *
 * @param {object[]} rows - header-normalized, validated rows
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} admin
 * @returns {Promise<{ created: number, updated: number, deleted: number, skipped: number, errors: object[] }>}
 */
export async function upsertProducts(rows, admin, { onProgress, options = {} } = {}) {
  const groups = groupRecords(rows);
  const ctx = new WriteContext(admin, options);
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [], results: new Array(groups.length) };

  let base = 0;
  for (const batch of chunk(groups, 16)) {
    const start = base;
    await Promise.all(batch.map((group, k) =>
      writeGroup(group, ctx, result).then((o) => { result.results[start + k] = o; onProgress?.(1); })
    ));
    base += batch.length;
    await sleep(20);
  }
  return result;
}

async function writeGroup(group, ctx, result) {
  const admin = ctx.admin;
  let built;
  try {
    built = buildProductSetInput(group);
  } catch (err) {
    result.errors.push({ title: group[0]?.title ?? "", message: err.message });
    return { status: "failed", comment: err.message };
  }
  const { command, identifier, input } = built;
  const label = input.title || input.handle || identifier?.id || "(unknown)";

  try {
    if (command === COMMAND.IGNORE) { result.skipped++; return { status: "skipped", comment: "Ignored (Command)" }; }

    if (command === COMMAND.DELETE) {
      const id = await resolveId(identifier, admin);
      if (!id) { result.skipped++; return { status: "skipped", comment: "No matching product to delete" }; }
      const errs = await deleteProduct(id, admin);
      if (errs.length) { result.errors.push({ title: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }
      result.deleted++;
      return { status: "deleted", comment: "" };
    }

    if (command === COMMAND.UPDATE || command === COMMAND.REPLACE) {
      const id = await resolveId(identifier, admin);
      if (!id) { result.skipped++; return { status: "skipped", comment: "No matching product to update" }; }
    }

    const existedBefore = Boolean(identifier);
    // "Generate redirects if handles change": a handle can only CHANGE when the
    // match is by id and the file supplies a handle — read the current handle
    // before the write so the old address is still known afterwards.
    let priorHandle = null;
    if (ctx.createRedirects && identifier?.id && input.handle) {
      priorHandle = await fetchHandle(identifier.id, admin);
    }
    const res = await admin.graphql(PRODUCT_SET, { variables: { input, identifier } });
    const payload = (await res.json())?.data?.productSet;
    const errs = payload?.userErrors ?? [];
    if (errs.length) { result.errors.push({ title: label, userErrors: errs }); return { status: "failed", comment: msgs(errs) }; }

    const product = payload?.product;
    existedBefore ? result.updated++ : result.created++;

    // Follow-up passes (best-effort; failures are reported, not fatal).
    await applyRedirectPass(priorHandle, product, ctx, result, label);
    await applyInventoryPass(group, product, ctx, result, label);
    await applyPublicationPass(group, product, ctx, result, label);
    return { status: existedBefore ? "updated" : "created", comment: "" };
  } catch (err) {
    result.errors.push({ title: label, message: err.message });
    return { status: "failed", comment: err.message };
  }
}

/** Join userError messages into one comment string. */
function msgs(errs) {
  return errs.map((e) => e.message).filter(Boolean).join("; ");
}

/**
 * The update changed the product's handle → the old product URL now 404s.
 * Create a redirect from the old address to the new one so links keep working.
 * A pre-existing redirect on that path just reports its userError (best-effort).
 */
async function applyRedirectPass(priorHandle, product, ctx, result, label) {
  const newHandle = product?.handle;
  if (!priorHandle || !newHandle || priorHandle === newHandle) return;
  const res = await ctx.admin.graphql(REDIRECT_CREATE, {
    variables: { redirect: { path: `/products/${priorHandle}`, target: `/products/${newHandle}` } },
  });
  const errs = (await res.json())?.data?.urlRedirectCreate?.userErrors ?? [];
  for (const e of errs) result.errors.push({ title: label, field: e.field, message: `Redirect: ${e.message}` });
}

async function applyInventoryPass(group, product, ctx, result, label) {
  const nodes = product?.variants?.nodes ?? [];
  if (!nodes.length) return;
  const variantRows = group.filter(isVariantRow);
  const bySku = new Map(variantRows.filter((r) => r.sku).map((r) => [String(r.sku).trim(), r]));

  const locationMap = await ctx.locations();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const row = (node.sku && bySku.get(String(node.sku).trim())) || variantRows[i];
    const invItemId = node.inventoryItem?.id;
    if (!row || !invItemId) continue;
    const problems = await applyInventory({ row, inventoryItemId: invItemId, locationMap, admin: ctx.admin });
    for (const p of problems) result.errors.push({ title: label, field: p.field, message: p.message });
  }
}

async function applyPublicationPass(group, product, ctx, result, label) {
  const published = String(topRow(group).published ?? "").trim();
  if (published === "" || !product?.id) return;
  const pubId = await ctx.onlineStorePublicationId();
  if (!pubId) return;

  const wantPublished = ["true", "1", "yes", "y", "x"].includes(published.toLowerCase());
  const mutation = wantPublished ? PUBLISH : UNPUBLISH;
  const key = wantPublished ? "publishablePublish" : "publishableUnpublish";
  const res = await ctx.admin.graphql(mutation, {
    variables: { id: product.id, input: [{ publicationId: pubId }] },
  });
  const errs = (await res.json())?.data?.[key]?.userErrors ?? [];
  for (const e of errs) result.errors.push({ title: label, field: e.field, message: e.message });
}

// ─── mutation wrappers ────────────────────────────────────────────────────────

async function deleteProduct(id, admin) {
  const res = await admin.graphql(PRODUCT_DELETE, { variables: { input: { id } } });
  return (await res.json())?.data?.productDelete?.userErrors ?? [];
}

/** Current handle of a product by id — null when it doesn't exist. */
async function fetchHandle(id, admin) {
  try {
    const res = await admin.graphql(PRODUCT_HANDLE, { variables: { id } });
    return (await res.json())?.data?.product?.handle ?? null;
  } catch {
    return null; // best-effort — no redirect is better than a failed import
  }
}

async function resolveId(identifier, admin) {
  if (!identifier) return null;
  if (identifier.id) return identifier.id;
  const res = await admin.graphql(PRODUCT_BY_IDENTIFIER, {
    variables: { identifier: { handle: identifier.handle } },
  });
  return (await res.json())?.data?.productByIdentifier?.id ?? null;
}

/**
 * Per-import-run resolution of locations and the Online Store publication,
 * each fetched at most once and reused across every product.
 */
class WriteContext {
  constructor(admin, options = {}) {
    this.admin = admin;
    this.createRedirects = Boolean(options.createRedirects);
    this._locations = null;
    this._pubId = undefined;
  }

  async locations() {
    if (!this._locations) {
      const res = await this.admin.graphql(LOCATIONS);
      const nodes = (await res.json())?.data?.locations?.nodes ?? [];
      this._locations = buildLocationMap(nodes);
    }
    return this._locations;
  }

  async onlineStorePublicationId() {
    if (this._pubId === undefined) {
      const res = await this.admin.graphql(PUBLICATIONS);
      const nodes = (await res.json())?.data?.publications?.nodes ?? [];
      const online = nodes.find((n) => n.name?.toLowerCase() === "online store");
      this._pubId = online?.id ?? nodes[0]?.id ?? null;
    }
    return this._pubId;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
