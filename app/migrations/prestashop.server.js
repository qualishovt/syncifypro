/**
 * migrations/prestashop.server.js
 *
 * PrestaShop Webservice connector. Validates an API key and pulls products,
 * categories→collections, customers (with address), orders (+ line items), and
 * cart rules→discounts, mapped to the app's row shape.
 *
 * Auth: HTTP Basic with the API key as the username (blank password). The
 * Webservice returns XML by default; we request JSON with `output_format=JSON`
 * and `display=full`. Localized fields (name, description) come back as
 * `[{ id, value }]` arrays — `ml()` takes the first language. Credentials are
 * used transiently.
 *
 * Note: PrestaShop images are served behind the authenticated Webservice, which
 * Shopify can't fetch, so images aren't migrated; country/state come back as
 * numeric ids and are left blank rather than mis-mapped.
 */

/** Webservice base: the shop URL + /api (a pasted URL already ending in /api is fine). */
function base(creds) {
  return `${String(creds.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "")}/api`;
}
function authHeader(creds) { return "Basic " + Buffer.from(`${creds.apiKey}:`).toString("base64"); }
function ml(v) { return Array.isArray(v) ? (v[0]?.value ?? "") : (v ?? ""); }
function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function isoDate(v) { if (!v) return ""; const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); }

const PAGE = 100;
const MAX_PAGES = 500;

/** Page a Webservice resource; JSON wraps rows under the resource key. */
async function fetchAll(creds, resource, key, onProgress, extraQs = "") {
  const out = [];
  for (let offset = 0, i = 0; i < MAX_PAGES; i++, offset += PAGE) {
    const url = `${base(creds)}/${resource}?output_format=JSON&display=full&limit=${offset},${PAGE}${extraQs}`;
    const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
    if (res.status === 401) throw new Error("Invalid API key.");
    if (!res.ok) throw new Error(`PrestaShop ${resource} returned HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    const items = body[key] || [];
    out.push(...items);
    onProgress?.(items.length);
    if (items.length < PAGE) break;
  }
  return out;
}

// ─── filters ──────────────────────────────────────────────────────────────────

// Default PrestaShop order states (id → name); the filter offers the names.
export const PS_ORDER_STATES = {
  1: "Awaiting check payment", 2: "Payment accepted", 3: "Processing in progress", 4: "Shipped",
  5: "Delivered", 6: "Canceled", 7: "Refunded", 8: "Payment error", 9: "On backorder (paid)",
  10: "Awaiting bank wire payment", 11: "Remote payment accepted", 12: "On backorder (not paid)",
  13: "Awaiting Cash On Delivery validation",
};

const dayStart = (v) => (typeof v === "string" && v.trim() ? `${v.trim()} 00:00:00` : null);
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
/** Webservice interval filter: filter[field]=[from,to] with date=1 (needs both ends). */
function dateFilter(field, after, before) {
  if (!after && !before) return "";
  return `&filter[${field}]=[${encodeURIComponent(after ?? "1970-01-01 00:00:00")},${encodeURIComponent(before ?? "2100-01-01 00:00:00")}]&date=1`;
}

/**
 * Map the page’s filters to Webservice query params for one resource.
 * @returns {string} query-string fragment starting with "&" (or "")
 */
export function psQuery(entity, filters = {}) {
  let q = "";
  if (entity === "products") {
    const st = list(filters.product_status).map((x) => x.toLowerCase());
    if (st.length === 1 && (st[0] === "active" || st[0] === "inactive")) q += `&filter[active]=[${st[0] === "active" ? 1 : 0}]`;
    q += dateFilter("date_add", dayStart(filters.product_created_after), dayStart(filters.product_created_before));
    q += dateFilter("date_upd", dayStart(filters.product_updated_after), dayStart(filters.product_updated_before));
  } else if (entity === "orders") {
    const names = new Set(list(filters.order_status).map((x) => x.toLowerCase()));
    const ids = Object.entries(PS_ORDER_STATES).filter(([, n]) => names.has(n.toLowerCase())).map(([id]) => id);
    if (ids.length) q += `&filter[current_state]=[${ids.join("|")}]`;
    q += dateFilter("date_add", dayStart(filters.order_created_after), dayStart(filters.order_created_before));
    q += dateFilter("date_upd", dayStart(filters.order_updated_after), dayStart(filters.order_updated_before));
  } else if (entity === "customers") {
    q += dateFilter("date_add", dayStart(filters.customer_created_after), dayStart(filters.customer_created_before));
    q += dateFilter("date_upd", dayStart(filters.customer_updated_after), dayStart(filters.customer_updated_before));
  }
  return q;
}

/** Cheap totals: id-only listing (one small request per resource). */
async function countIds(creds, resource, key) {
  try {
    const res = await fetch(`${base(creds)}/${resource}?output_format=JSON&display=[id]`, { headers: { Authorization: authHeader(creds) } });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body[key]) ? body[key].length : 0;
  } catch { return null; }
}

export async function validatePresta(creds) {
  if (!creds.baseUrl || !creds.apiKey) return { ok: false, error: "Fill in the shop URL and API key." };
  if (!/^https?:\/\//i.test(creds.baseUrl)) return { ok: false, error: "Shop URL must start with http(s)://" };

  let res;
  try {
    res = await fetch(`${base(creds)}/products?output_format=JSON&limit=0,1`, { headers: { Authorization: authHeader(creds) } });
  } catch (e) {
    return { ok: false, error: `Couldn't reach PrestaShop: ${e.message}` };
  }
  if (res.status === 401) return { ok: false, error: "Invalid API key." };
  if (res.status === 404) return { ok: false, error: "PrestaShop Webservice not found — enable it and the products resource." };
  if (!res.ok) return { ok: false, error: `PrestaShop returned HTTP ${res.status}.` };
  const [products, customers, orders, collections] = await Promise.all([
    countIds(creds, "products", "products"), countIds(creds, "customers", "customers"),
    countIds(creds, "orders", "orders"), countIds(creds, "categories", "categories"),
  ]);
  return { ok: true, counts: { products, customers, orders, collections } };
}

async function categoryNameMap(creds) {
  try {
    const cats = await fetchAll(creds, "categories", "categories");
    return new Map(cats.map((c) => [String(c.id), ml(c.name)]));
  } catch { return new Map(); }
}

export async function fetchPrestaProducts(creds, onProgress, filters = {}) {
  const catMap = await categoryNameMap(creds);
  const products = await fetchAll(creds, "products", "products", onProgress, psQuery("products", filters));
  const rows = [];
  let rn = 1;
  for (const p of products) {
    const catNames = (p.associations?.categories || []).map((c) => catMap.get(String(c.id))).filter(Boolean);
    rows.push({
      command: "MERGE",
      handle: ml(p.link_rewrite) || slug(ml(p.name)),
      title: ml(p.name), body_html: ml(p.description) || ml(p.description_short) || "",
      vendor: p.manufacturer_name || "", product_type: catNames[0] || "", tags: catNames.join(", "),
      status: String(p.active) === "1" ? "ACTIVE" : "DRAFT", published: String(p.active) === "1" ? "TRUE" : "FALSE",
      top_row: "TRUE", row_number: rn++, image_url: "",
      sku: p.reference || "", weight: p.weight != null ? String(p.weight) : "",
      price: p.price != null ? String(p.price) : "", compare_at_price: "",
      inventory_qty: p.quantity != null ? String(p.quantity) : "",
    });
  }
  return rows;
}

export async function fetchPrestaCategories(creds, onProgress) {
  const cats = await fetchAll(creds, "categories", "categories", onProgress);
  return cats
    .filter((c) => Number(c.level_depth) >= 2 && ml(c.name))
    .map((c) => ({
      command: "MERGE",
      handle: ml(c.link_rewrite) || slug(ml(c.name)),
      title: ml(c.name), body_html: ml(c.description) || "",
      collection_type: "smart", rules_match: "any",
      rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: ml(c.name) }]),
      image_url: "",
    }));
}

export async function fetchPrestaCustomers(creds, onProgress, filters = {}) {
  const customers = await fetchAll(creds, "customers", "customers", onProgress, psQuery("customers", filters));
  let addrs = [];
  try { addrs = await fetchAll(creds, "addresses", "addresses"); } catch { addrs = []; }
  const byCustomer = new Map();
  for (const a of addrs) if (!byCustomer.has(String(a.id_customer))) byCustomer.set(String(a.id_customer), a);

  let rn = 1;
  return customers.map((c) => {
    const a = byCustomer.get(String(c.id)) || {};
    return {
      command: "MERGE",
      email: c.email || "", first_name: c.firstname || "", last_name: c.lastname || "", phone: a.phone || a.phone_mobile || "",
      address_command: "MERGE",
      address_first_name: a.firstname || c.firstname || "", address_last_name: a.lastname || c.lastname || "",
      address_company: a.company || "", address_phone: a.phone || "",
      address1: a.address1 || "", address2: a.address2 || "", address_city: a.city || "",
      address_province: "", address_country: "", address_zip: a.postcode || "",
      address_top_row: "TRUE", address_row_number: 1, top_row: "TRUE", row_number: rn++,
    };
  }).filter((r) => r.email);
}

// Default PrestaShop order-state ids → Shopify financial status (best effort).
const P_STATE_FINANCIAL = {
  "1": "PENDING", "2": "PAID", "3": "PAID", "4": "PAID", "5": "PAID", "11": "PAID",
  "6": "VOIDED", "7": "REFUNDED", "8": "VOIDED", "9": "PENDING", "10": "PENDING",
};

export async function fetchPrestaOrders(creds, onProgress, filters = {}) {
  const orders = await fetchAll(creds, "orders", "orders", onProgress, psQuery("orders", filters));
  const rows = [];
  let rn = 1;
  for (const o of orders) {
    const items = (o.associations?.order_rows || []).filter((x) => x.product_name);
    if (items.length === 0) continue;
    const top = {
      command: "NEW",
      order_name: o.reference ? `#${o.reference}` : (o.id ? `#${o.id}` : ""),
      email: "", phone: "",
      financial_status: P_STATE_FINANCIAL[String(o.current_state)] || "PENDING",
      fulfillment_status: "",
      currency: "", created_at: isoDate(o.date_add),
      total_price: o.total_paid != null ? String(o.total_paid) : "",
    };
    items.forEach((item, i) => {
      rows.push({
        ...(i === 0 ? top : {}),
        line_type: "Line Item", top_row: i === 0 ? "TRUE" : "", row_number: rn++,
        line_item_title: item.product_name || "", line_item_name: item.product_name || "",
        line_item_quantity: item.product_quantity != null ? String(item.product_quantity) : "",
        line_item_price: item.unit_price_tax_incl != null ? String(item.unit_price_tax_incl) : (item.product_price || ""),
        line_item_sku: item.product_reference || "",
      });
    });
  }
  return rows;
}

export async function fetchPrestaCoupons(creds, onProgress) {
  const rules = await fetchAll(creds, "cart_rules", "cart_rules", onProgress);
  return rules.map((r) => {
    const pct = Number(r.reduction_percent || 0);
    const amt = Number(r.reduction_amount || 0);
    let value_type, value;
    if (pct > 0) { value_type = "percentage"; value = String(pct); }
    else if (amt > 0) { value_type = "fixed_amount"; value = String(amt); }
    else return null;
    return {
      command: "MERGE", codes: r.code || "", title: ml(r.name) || r.code || "",
      value_type, value,
      ends_at: r.date_to ? isoDate(r.date_to) : "",
      usage_limit: r.quantity ? String(r.quantity) : "",
      once_per_customer: Number(r.quantity_per_user) === 1 ? "TRUE" : "",
      minimum_subtotal: r.minimum_amount && Number(r.minimum_amount) > 0 ? String(r.minimum_amount) : "",
    };
  }).filter(Boolean).filter((r) => r.codes);
}
