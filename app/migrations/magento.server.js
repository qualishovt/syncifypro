/**
 * migrations/magento.server.js
 *
 * Magento 2 connector. Validates an integration access token and pulls
 * products, categories→collections, customers (with address), orders (+ line
 * items), and coupons→discounts, mapped to the app's row shape.
 *
 * Auth: `Authorization: Bearer <token>`. Everything is under `/rest/V1`, paged
 * with Magento's searchCriteria params. Product detail lives partly in
 * `custom_attributes` (description, url_key) and `extension_attributes`
 * (stock qty, category links). Credentials are used transiently.
 */

function base(creds) { return `${String(creds.baseUrl || "").trim().replace(/\/+$/, "")}/rest/V1`; }
function headers(creds) {
  return { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json", "Content-Type": "application/json" };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 500;

/** Page through a searchCriteria endpoint (`{ items, total_count }`). */
async function searchAll(creds, endpoint, onProgress) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base(creds)}/${endpoint}${sep}searchCriteria[pageSize]=${PAGE_SIZE}&searchCriteria[currentPage]=${page}`;
    const res = await fetch(url, { headers: headers(creds) });
    if (!res.ok) throw new Error(`Magento ${endpoint} returned HTTP ${res.status}`);
    const body = await res.json();
    const items = body.items || [];
    out.push(...items);
    onProgress?.(items.length);
    const total = body.total_count ?? out.length;
    if (items.length < PAGE_SIZE || out.length >= total) break;
  }
  return out;
}

async function countSearch(creds, endpoint) {
  try {
    const res = await fetch(`${base(creds)}/${endpoint}?searchCriteria[pageSize]=1`, { headers: headers(creds) });
    if (!res.ok) return null;
    return (await res.json()).total_count ?? null;
  } catch { return null; }
}

export async function validateMagento(creds) {
  if (!creds.baseUrl || !creds.accessToken) {
    return { ok: false, error: "Fill in the store URL and access token." };
  }
  if (!/^https?:\/\//i.test(creds.baseUrl)) return { ok: false, error: "Store URL must start with http(s)://" };

  let res;
  try {
    res = await fetch(`${base(creds)}/products?searchCriteria[pageSize]=1`, { headers: headers(creds) });
  } catch (e) {
    return { ok: false, error: `Couldn't reach Magento: ${e.message}` };
  }
  if (res.status === 401) return { ok: false, error: "Invalid access token." };
  if (res.status === 404) return { ok: false, error: "Magento REST API not found at that URL." };
  if (!res.ok) return { ok: false, error: `Magento returned HTTP ${res.status}.` };

  const products = (await res.json()).total_count ?? 0;
  const [collections, customers, orders] = await Promise.all([
    countSearch(creds, "categories/list"),
    countSearch(creds, "customers/search"),
    countSearch(creds, "orders"),
  ]);
  return { ok: true, counts: { products, customers, orders, collections } };
}

// ─── mapping helpers ───────────────────────────────────────────────────────────

function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function isoDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
function attr(p, code) {
  const a = (p.custom_attributes || []).find((x) => x.attribute_code === code);
  return a ? a.value : undefined;
}
function mediaUrl(creds, file) {
  if (!file) return "";
  const b = String(creds.baseUrl || "").replace(/\/+$/, "");
  return `${b}/media/catalog/product${file.startsWith("/") ? "" : "/"}${file}`;
}

async function categoryNameMap(creds) {
  try {
    const cats = await searchAll(creds, "categories/list");
    return new Map(cats.map((c) => [c.id, c.name]));
  } catch { return new Map(); }
}

// ─── fetchers ───────────────────────────────────────────────────────────────────

export async function fetchMagentoProducts(creds, onProgress) {
  const catMap = await categoryNameMap(creds);
  const products = await searchAll(creds, "products", onProgress);
  const rows = [];
  let rn = 1;

  for (const p of products) {
    if (Number(p.visibility) === 1) continue; // configurable children / not individually visible
    const catIds = (p.extension_attributes?.category_links || []).map((c) => Number(c.category_id));
    const catNames = catIds.map((id) => catMap.get(id)).filter(Boolean);
    const media = (p.media_gallery_entries || []).map((m) => mediaUrl(creds, m.file)).filter(Boolean);
    const desc = attr(p, "description") || attr(p, "short_description") || "";

    rows.push({
      command: "MERGE",
      handle: attr(p, "url_key") || slug(p.name),
      title: p.name || "", body_html: desc,
      vendor: "", product_type: catNames[0] || "", tags: catNames.join(", "),
      status: Number(p.status) === 1 ? "ACTIVE" : "DRAFT", published: Number(p.status) === 1 ? "TRUE" : "FALSE",
      top_row: "TRUE", row_number: rn++, image_url: media[0] || "",
      sku: p.sku || "", weight: p.weight != null ? String(p.weight) : "",
      price: p.price != null ? String(p.price) : "", compare_at_price: "",
      inventory_qty: p.extension_attributes?.stock_item?.qty != null ? String(p.extension_attributes.stock_item.qty) : "",
    });
    media.slice(1).forEach((src) => rows.push({ top_row: "", row_number: rn++, image_url: src }));
  }
  return rows;
}

export async function fetchMagentoCategories(creds, onProgress) {
  let cats = [];
  try { cats = await searchAll(creds, "categories/list", onProgress); } catch { cats = []; }
  return cats
    .filter((c) => c.name && (c.level == null || c.level >= 2)) // skip root / default
    .map((c) => ({
      command: "MERGE", handle: slug(c.name), title: c.name, body_html: "",
      collection_type: "smart", rules_match: "any",
      rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: c.name }]),
      image_url: "",
    }));
}

export async function fetchMagentoCustomers(creds, onProgress) {
  const customers = await searchAll(creds, "customers/search", onProgress);
  let rn = 1;
  return customers.map((c) => {
    const a = (c.addresses || [])[0] || {};
    const region = a.region?.region || a.region_code || "";
    const street = a.street || [];
    return {
      command: "MERGE",
      email: c.email || "", first_name: c.firstname || "", last_name: c.lastname || "", phone: a.telephone || "",
      address_command: "MERGE",
      address_first_name: a.firstname || c.firstname || "", address_last_name: a.lastname || c.lastname || "",
      address_company: a.company || "", address_phone: a.telephone || "",
      address1: street[0] || "", address2: street[1] || "", address_city: a.city || "",
      address_province: region, address_country: a.country_id || "", address_zip: a.postcode || "",
      address_top_row: "TRUE", address_row_number: 1, top_row: "TRUE", row_number: rn++,
    };
  }).filter((r) => r.email);
}

const M_FINANCIAL = {
  complete: "PAID", processing: "PAID", pending: "PENDING", pending_payment: "PENDING",
  closed: "REFUNDED", canceled: "VOIDED", holded: "PENDING", fraud: "VOIDED",
};

export async function fetchMagentoOrders(creds, onProgress) {
  const orders = await searchAll(creds, "orders", onProgress);
  const rows = [];
  let rn = 1;

  for (const o of orders) {
    const li = (o.items || []).filter((x) => x.name && x.parent_item_id == null);
    if (li.length === 0) continue;

    const b = o.billing_address || {};
    const region = b.region || b.region_code || "";
    const street = b.street || [];
    const top = {
      command: "NEW",
      order_name: o.increment_id ? `#${o.increment_id}` : "",
      email: o.customer_email || "", phone: b.telephone || "",
      financial_status: M_FINANCIAL[o.status] || M_FINANCIAL[o.state] || "PENDING",
      fulfillment_status: o.status === "complete" ? "FULFILLED" : "",
      currency: o.order_currency_code || "", created_at: isoDate(o.created_at),
      total_price: o.grand_total != null ? String(o.grand_total) : "",
      billing_first_name: b.firstname || "", billing_last_name: b.lastname || "", billing_company: b.company || "", billing_phone: b.telephone || "",
      billing_address1: street[0] || "", billing_address2: street[1] || "",
      billing_city: b.city || "", billing_province: region, billing_zip: b.postcode || "", billing_country: b.country_id || "",
    };

    li.forEach((item, i) => {
      rows.push({
        ...(i === 0 ? top : {}),
        line_type: "Line Item", top_row: i === 0 ? "TRUE" : "", row_number: rn++,
        line_item_title: item.name || "", line_item_name: item.name || "",
        line_item_quantity: item.qty_ordered != null ? String(item.qty_ordered) : "",
        line_item_price: item.price != null ? String(item.price) : "",
        line_item_sku: item.sku || "",
      });
    });
  }
  return rows;
}

const M_ACTION = { by_percent: "percentage", by_fixed: "fixed_amount", cart_fixed: "fixed_amount" };

export async function fetchMagentoCoupons(creds, onProgress) {
  let coupons = [];
  try { coupons = await searchAll(creds, "coupons/search", onProgress); } catch { coupons = []; }
  let rules = [];
  try { rules = await searchAll(creds, "salesRules/search"); } catch { rules = []; }
  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));

  return coupons.map((c) => {
    const r = ruleMap.get(c.rule_id) || {};
    const vt = M_ACTION[r.simple_action];
    if (!vt) return null;
    return {
      command: "MERGE", codes: c.code || "", title: r.name || c.code || "",
      value_type: vt, value: r.discount_amount != null ? String(r.discount_amount) : "",
      ends_at: r.to_date ? isoDate(r.to_date) : "",
      usage_limit: c.usage_limit ? String(c.usage_limit) : (r.uses_per_coupon ? String(r.uses_per_coupon) : ""),
      once_per_customer: Number(r.uses_per_customer) === 1 ? "TRUE" : "",
      minimum_subtotal: "",
    };
  }).filter(Boolean).filter((r) => r.codes);
}
