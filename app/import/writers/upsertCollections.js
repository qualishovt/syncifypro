/**
 * import/writers/upsertCollections.js
 *
 * Creates / updates / deletes collections from validated rows. Supports manual
 * collections and smart (automated) collections via a `ruleSet` — a Woo
 * category migrates to a smart collection with a "product tag = <category>" rule
 * so it auto-populates once the tagged products land.
 *
 * Per row: DELETE → collectionDelete; existing (by collection_id or handle) →
 * collectionUpdate; otherwise → collectionCreate. Requires write_products.
 */

const CREATE = `#graphql
  mutation CreateCollection($input: CollectionInput!) {
    collectionCreate(input: $input) { collection { id } userErrors { field message } }
  }`;
const UPDATE = `#graphql
  mutation UpdateCollection($input: CollectionInput!) {
    collectionUpdate(input: $input) { collection { id } userErrors { field message } }
  }`;
const DELETE = `#graphql
  mutation DeleteCollection($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
  }`;
const FIND = `#graphql
  query FindCollection($q: String!) { collections(first: 1, query: $q) { nodes { id } } }`;

const RULE_COLUMNS = new Set(["TAG", "TYPE", "VENDOR", "TITLE", "VARIANT_TITLE", "VARIANT_PRICE", "VARIANT_INVENTORY", "VARIANT_WEIGHT", "PRODUCT_TAXONOMY_NODE_ID", "IS_PRICE_REDUCED"]);
const RULE_RELATIONS = new Set(["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "STARTS_WITH", "ENDS_WITH", "CONTAINS", "NOT_CONTAINS", "IS_SET", "IS_NOT_SET"]);

export async function upsertCollections(rows, admin, { onProgress } = {}) {
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [], results: new Array(rows.length) };

  let base = 0;
  for (const batch of chunk(rows, 5)) {
    const start = base;
    await Promise.all(batch.map((row, k) =>
      writeRow(row, admin, result).then((o) => { result.results[start + k] = o; })));
    base += batch.length;
    onProgress?.(batch.length);
    await sleep(50);
  }
  return result;
}

async function writeRow(row, admin, result) {
  const label = row.title || row.handle || row.collection_id || "(collection)";
  const command = (row.command || "").trim().toUpperCase() || "MERGE";
  try {
    const existingId = await resolveId(row, admin);

    if (command === "DELETE") {
      if (!existingId) { result.skipped++; return { status: "skipped", comment: "No matching collection to delete" }; }
      const ue = await run(admin, DELETE, { input: { id: existingId } }, "collectionDelete");
      if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
      result.deleted++;
      return { status: "deleted", comment: "" };
    }

    const input = collectionInput(row);
    if (existingId) {
      const ue = await run(admin, UPDATE, { input: { ...input, id: existingId } }, "collectionUpdate");
      if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
      result.updated++;
      return { status: "updated", comment: "" };
    }
    const ue = await run(admin, CREATE, { input }, "collectionCreate");
    if (ue.length) { result.errors.push({ path: label, userErrors: ue }); return { status: "failed", comment: msgs(ue) }; }
    result.created++;
    return { status: "created", comment: "" };
  } catch (err) {
    result.errors.push({ path: label, message: err.message });
    return { status: "failed", comment: err.message };
  }
}

/** Existing collection id from an explicit collection_id, else a handle lookup. */
async function resolveId(row, admin) {
  if (row.collection_id) return `gid://shopify/Collection/${String(row.collection_id).replace(/\D/g, "")}`;
  const handle = String(row.handle || "").trim();
  if (!handle) return null;
  const res = await admin.graphql(FIND, { variables: { q: `handle:${handle}` } });
  const { data } = await res.json();
  return data?.collections?.nodes?.[0]?.id ?? null;
}

function collectionInput(row) {
  const input = {};
  if (str(row.title)) input.title = row.title;
  if (str(row.handle)) input.handle = row.handle;
  const desc = str(row.body_html) || str(row.description);
  if (desc) input.descriptionHtml = desc;
  if (str(row.image_url)) input.image = { src: row.image_url, ...(str(row.image_alt) ? { altText: row.image_alt } : {}) };
  if (str(row.seo_title) || str(row.seo_description)) {
    input.seo = {};
    if (str(row.seo_title)) input.seo.title = row.seo_title;
    if (str(row.seo_description)) input.seo.description = row.seo_description;
  }
  const rules = parseRules(row.rules);
  if ((str(row.collection_type).toLowerCase() === "smart" || rules.length) && rules.length) {
    input.ruleSet = { appliedDisjunctively: str(row.rules_match).toLowerCase() === "any", rules };
  }
  return input;
}

/** Parse the `rules` cell (JSON array of {column,relation,condition}). */
function parseRules(raw) {
  if (!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => ({
      column: String(r.column || "").toUpperCase(),
      relation: String(r.relation || "EQUALS").toUpperCase(),
      condition: String(r.condition ?? ""),
    }))
    .filter((r) => RULE_COLUMNS.has(r.column) && RULE_RELATIONS.has(r.relation) && r.condition !== "");
}

function msgs(errs) { return errs.map((e) => e.message).filter(Boolean).join("; "); }
function str(v) { return String(v ?? "").trim(); }

async function run(admin, mutation, variables, field) {
  const res = await admin.graphql(mutation, { variables });
  const { data } = await res.json();
  return data?.[field]?.userErrors ?? [];
}
function chunk(arr, size) { const r = []; for (let i = 0; i < arr.length; i += size) r.push(arr.slice(i, i + size)); return r; }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
