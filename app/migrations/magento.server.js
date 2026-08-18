/**
 * migrations/magento.server.js
 *
 * Magento 2 connector. Validates an integration access token and pulls
 * products (configurable products as real variants), categories→collections,
 * customers (with address), orders (+ line items), coupons→discounts, and
 * generated redirects, mapped to the app's row shape.
 *
 * Auth: `Authorization: Bearer <token>`. Everything is under `/rest/V1`
 * (or `/rest/<store>/V1` when the Store URL ends in `/rest/<store>`), paged
 * with Magento's searchCriteria params. Product detail lives partly in
 * `custom_attributes` (description, url_key) and `extension_attributes`
 * (stock qty, category links, configurable options). Credentials are used
 * transiently.
 *
 * The network layer (searchAll / getJson) is thin; the row mapping is done by
 * exported pure functions (mapMagento*) that take already-fetched payloads,
 * so the mapping is unit-testable against fixture JSON without a live store.
 */

// ─── network ────────────────────────────────────────────────────────────────

/** REST base: honours a trailing "/rest/<storeCode>" in the Store URL. */
function base(creds) {
  const u = String(creds.baseUrl || "").trim().replace(/\/+$/, "");
  return /\/rest\/[^/]+$/i.test(u) ? `${u}/V1` : `${u}/rest/V1`;
}
function siteBase(creds) {
  return String(creds.baseUrl || "").trim().replace(/\/+$/, "").replace(/\/rest\/[^/]+$/i, "");
}
function headers(creds) {
  return { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json", "Content-Type": "application/json" };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 500;

async function getJson(creds, path) {
  const res = await fetch(`${base(creds)}/${path}`, { headers: headers(creds) });
  if (!res.ok) throw new Error(`Magento ${path.split("?")[0]} returned HTTP ${res.status}`);
  return res.json();
}

/**
 * Page through a searchCriteria endpoint (`{ items, total_count }`), with
 * optional filter groups (AND across groups, OR within a group).
 * @param {Array<{field:string, value:string, condition:string}>} [criteria]
 */
async function searchAll(creds, endpoint, onProgress, criteria = []) {
  const sep = endpoint.includes("?") ? "&" : "?";
  const filterQs = criteriaQuery(criteria);
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base(creds)}/${endpoint}${sep}searchCriteria[pageSize]=${PAGE_SIZE}&searchCriteria[currentPage]=${page}${filterQs}`;
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

/** searchCriteria[filter_groups][i][filters][0][field|value|condition_type]=… */
export function criteriaQuery(criteria) {
  return criteria.map((c, i) => {
    const p = `&searchCriteria[filter_groups][${i}][filters][0]`;
    return `${p}[field]=${encodeURIComponent(c.field)}${p}[value]=${encodeURIComponent(c.value)}${p}[condition_type]=${encodeURIComponent(c.condition)}`;
  }).join("");
}

async function countSearch(creds, endpoint) {
  try {
    const res = await fetch(`${base(creds)}/${endpoint}?searchCriteria[pageSize]=1`, { headers: headers(creds) });
    if (!res.ok) return null;
    return (await res.json()).total_count ?? null;
  } catch { return null; }
}

// ─── filters → searchCriteria ────────────────────────────────────────────────

const M_PRODUCT_STATUS = { enabled: "1", disabled: "2" };

/**
 * Map the page's filters ({ product_status: [...], order_created_after: "YYYY-MM-DD", … })
 * to Magento searchCriteria filter groups for one entity.
 * @returns {Array<{field:string, value:string, condition:string}>}
 */
export function magentoCriteria(entity, filters = {}) {
  const out = [];
  const list = (key) => (Array.isArray(filters[key]) ? filters[key].map((v) => String(v).trim()).filter(Boolean) : []);
  const date = (key) => (typeof filters[key] === "string" && filters[key].trim() ? filters[key].trim() : null);
  const range = (prefix, field) => {
    const after = date(`${prefix}_after`);
    const before = date(`${prefix}_before`);
    if (after) out.push({ field, value: `${after} 00:00:00`, condition: "gteq" });
    if (before) out.push({ field, value: `${before} 00:00:00`, condition: "lt" });
  };

  if (entity === "products") {
    const st = list("product_status").map((s) => M_PRODUCT_STATUS[s.toLowerCase()] ?? s);
    if (st.length) out.push({ field: "status", value: st.join(","), condition: "in" });
    range("product_created", "created_at");
    range("product_updated", "updated_at");
  } else if (entity === "orders") {
    const st = list("order_status");
    if (st.length) out.push({ field: "status", value: st.join(","), condition: "in" });
    range("order_created", "created_at");
    range("order_updated", "updated_at");
  } else if (entity === "customers") {
    range("customer_created", "created_at");
    range("customer_updated", "updated_at");
  }
  return out;
}

// ─── validate ────────────────────────────────────────────────────────────────

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

export function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
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
  return `${siteBase(creds)}/media/catalog/product${file.startsWith("/") ? "" : "/"}${file}`;
}
function num(v) { return v == null || v === "" ? "" : String(v); }
/** Qty from the product payload (single-product GET) or the bulk stock map. */
function stockQty(p, stockBySku) {
  const q = p.extension_attributes?.stock_item?.qty ?? stockBySku?.get(p.sku);
  return q != null ? String(q) : "";
}

/**
 * sku → quantity for the whole catalog. The /products LIST omits stock_item,
 * so read MSI source items in one paged call (default source); on stores
 * without MSI fall back to per-SKU stockItems for the given skus.
 */
async function fetchStockMap(creds, skus) {
  const map = new Map();
  try {
    const items = await searchAll(creds, "inventory/source-items");
    for (const it of items) if (it.sku != null && it.quantity != null) map.set(it.sku, Number(map.get(it.sku) ?? 0) + Number(it.quantity));
    if (map.size) return map;
  } catch { /* MSI absent → legacy stock below */ }
  for (const sku of skus) {
    try {
      const s = await getJson(creds, `stockItems/${encodeURIComponent(sku)}`);
      if (s?.qty != null) map.set(sku, Number(s.qty));
    } catch { /* leave blank */ }
  }
  return map;
}

async function categoryNameMap(creds) {
  try {
    const cats = await searchAll(creds, "categories/list");
    return new Map(cats.map((c) => [c.id, c.name]));
  } catch { return new Map(); }
}

// ─── products (incl. configurable → variants) ─────────────────────────────────

/**
 * Pure: products payload → rows.
 * @param {object} src
 * @param {object[]} src.products - the /products items (all types)
 * @param {Map<number,string>} src.catMap - category id → name
 * @param {Map<string, object[]>} src.childrenBySku - configurable sku → child products
 * @param {Map<number, {code:string, label:string, values:Map<string,string>}>} src.attributesById
 *        configurable option attribute id → { attribute_code, frontend label, option value → label }
 * @param {object} src.creds - for media URLs
 * @param {Map<string, number>} [src.stockBySku] - bulk stock quantities (list payloads lack stock_item)
 */
export function mapMagentoProducts({ products, catMap, childrenBySku, attributesById, creds, stockBySku }) {
  const rows = [];
  let rn = 1;
  const linked = new Set(); // child skus consumed by a configurable parent

  for (const p of products) {
    if (p.type_id !== "configurable") continue;
    for (const c of childrenBySku.get(p.sku) ?? []) linked.add(c.sku);
  }

  for (const p of products) {
    if (linked.has(p.sku)) continue;                       // emitted under its parent
    if (Number(p.visibility) === 1 && p.type_id !== "configurable") continue; // not individually visible, no parent found

    const catIds = (p.extension_attributes?.category_links || []).map((c) => Number(c.category_id));
    const catNames = catIds.map((id) => catMap.get(id)).filter(Boolean);
    const media = (p.media_gallery_entries || []).map((m) => mediaUrl(creds, m.file)).filter(Boolean);
    const desc = attr(p, "description") || attr(p, "short_description") || "";
    const active = Number(p.status) === 1;

    const top = {
      command: "MERGE",
      handle: attr(p, "url_key") || slug(p.name),
      title: p.name || "", body_html: desc,
      vendor: "", product_type: catNames[0] || "", tags: catNames.join(", "),
      status: active ? "ACTIVE" : "DRAFT", published: active ? "TRUE" : "FALSE",
      top_row: "TRUE", row_number: rn++, image_url: media[0] || "",
    };

    const children = p.type_id === "configurable" ? (childrenBySku.get(p.sku) ?? []) : [];
    const options = (p.extension_attributes?.configurable_product_options || [])
      .map((o) => ({ ...o, meta: attributesById.get(Number(o.attribute_id)) }))
      .filter((o) => o.meta)
      .slice(0, 3);

    if (children.length && options.length) {
      // One row per child variant: option values from the child's own
      // attribute values, resolved to labels via the attribute's option list.
      children.forEach((c, i) => {
        const row = i === 0 ? top : { top_row: "", row_number: rn++ };
        options.forEach((o, k) => {
          const raw = attr(c, o.meta.code);
          row[`option${k + 1}_name`] = o.label || o.meta.label || o.meta.code;
          row[`option${k + 1}_value`] = o.meta.values.get(String(raw)) ?? String(raw ?? "");
        });
        row.sku = c.sku || "";
        row.weight = num(c.weight);
        row.price = num(c.price);
        row.compare_at_price = "";
        row.inventory_qty = stockQty(c, stockBySku);
        const cm = (c.media_gallery_entries || []).map((m) => mediaUrl(creds, m.file)).filter(Boolean);
        if (i > 0 && cm[0]) row.image_url = cm[0];
        rows.push(row);
      });
    } else {
      rows.push({
        ...top,
        sku: p.sku || "", weight: num(p.weight),
        price: num(p.price), compare_at_price: "",
        inventory_qty: stockQty(p, stockBySku),
      });
    }
    media.slice(1).forEach((src) => rows.push({ top_row: "", row_number: rn++, image_url: src }));
  }
  return rows;
}

/** Load the option attribute (code, label, value→label) for a configurable option. */
async function loadAttribute(creds, attributeId, cache) {
  if (cache.has(attributeId)) return cache.get(attributeId);
  let meta = null;
  try {
    const a = await getJson(creds, `products/attributes/${attributeId}`);
    meta = {
      code: a.attribute_code,
      label: a.default_frontend_label || a.attribute_code,
      values: new Map((a.options || []).map((o) => [String(o.value), o.label])),
    };
  } catch { meta = null; }
  cache.set(attributeId, meta);
  return meta;
}

export async function fetchMagentoProducts(creds, onProgress, filters = {}) {
  const catMap = await categoryNameMap(creds);
  const products = await searchAll(creds, "products", onProgress, magentoCriteria("products", filters));

  // Configurable products: children + the option attributes' value labels.
  const childrenBySku = new Map();
  const attributesById = new Map();
  const attrCache = new Map();
  for (const p of products) {
    if (p.type_id !== "configurable") continue;
    try {
      childrenBySku.set(p.sku, await getJson(creds, `configurable-products/${encodeURIComponent(p.sku)}/children`));
    } catch { childrenBySku.set(p.sku, []); }
    for (const o of p.extension_attributes?.configurable_product_options || []) {
      const id = Number(o.attribute_id);
      const meta = await loadAttribute(creds, id, attrCache);
      if (meta) attributesById.set(id, meta);
    }
  }
  const allSkus = [...products.map((p) => p.sku), ...[...childrenBySku.values()].flat().map((c) => c.sku)].filter(Boolean);
  const stockBySku = await fetchStockMap(creds, allSkus);
  return mapMagentoProducts({ products, catMap, childrenBySku, attributesById, creds, stockBySku });
}

// ─── categories → collections ─────────────────────────────────────────────────

/** Pure: categories/list items → collection rows (roots skipped). */
export function mapMagentoCategories(cats) {
  return cats
    .filter((c) => c.name && (c.level == null || c.level >= 2)) // skip root / default
    .map((c) => ({
      command: "MERGE", handle: attr(c, "url_key") || slug(c.name), title: c.name, body_html: attr(c, "description") || "",
      collection_type: "smart", rules_match: "any",
      rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: c.name }]),
      image_url: "",
    }));
}

export async function fetchMagentoCategories(creds, onProgress) {
  let cats = [];
  try { cats = await searchAll(creds, "categories/list", onProgress); } catch { cats = []; }
  return mapMagentoCategories(cats);
}

// ─── customers ────────────────────────────────────────────────────────────────

/** Pure: customers/search items → customer rows (first address). */
export function mapMagentoCustomers(customers) {
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

export async function fetchMagentoCustomers(creds, onProgress, filters = {}) {
  const customers = await searchAll(creds, "customers/search", onProgress, magentoCriteria("customers", filters));
  return mapMagentoCustomers(customers);
}

// ─── orders ───────────────────────────────────────────────────────────────────

const M_FINANCIAL = {
  complete: "PAID", processing: "PAID", pending: "PENDING", pending_payment: "PENDING",
  closed: "REFUNDED", canceled: "VOIDED", holded: "PENDING", fraud: "VOIDED", payment_review: "PENDING",
};

/** Pure: orders items → order rows (one per line item, header on the first). */
export function mapMagentoOrders(orders) {
  const rows = [];
  let rn = 1;

  for (const o of orders) {
    const li = (o.items || []).filter((x) => x.name && x.parent_item_id == null);
    if (li.length === 0) continue;

    const b = o.billing_address || {};
    const region = b.region || b.region_code || "";
    const street = b.street || [];
    const s = o.extension_attributes?.shipping_assignments?.[0]?.shipping?.address || {};
    const sStreet = s.street || [];
    const top = {
      command: "NEW",
      order_name: o.increment_id ? `#${o.increment_id}` : "",
      email: o.customer_email || "", phone: b.telephone || "",
      financial_status: M_FINANCIAL[o.status] || M_FINANCIAL[o.state] || "PENDING",
      fulfillment_status: o.status === "complete" ? "FULFILLED" : "",
      currency: o.order_currency_code || "", created_at: isoDate(o.created_at),
      total_price: num(o.grand_total),
      billing_first_name: b.firstname || "", billing_last_name: b.lastname || "", billing_company: b.company || "", billing_phone: b.telephone || "",
      billing_address1: street[0] || "", billing_address2: street[1] || "",
      billing_city: b.city || "", billing_province: region, billing_zip: b.postcode || "", billing_country: b.country_id || "",
      shipping_first_name: s.firstname || "", shipping_last_name: s.lastname || "", shipping_company: s.company || "", shipping_phone: s.telephone || "",
      shipping_address1: sStreet[0] || "", shipping_address2: sStreet[1] || "",
      shipping_city: s.city || "", shipping_province: s.region || s.region_code || "", shipping_zip: s.postcode || "", shipping_country: s.country_id || "",
      shipping_line_title: o.shipping_description || "", shipping_line_price: num(o.shipping_amount),
    };

    li.forEach((item, i) => {
      rows.push({
        ...(i === 0 ? top : {}),
        line_type: "Line Item", top_row: i === 0 ? "TRUE" : "", row_number: rn++,
        line_item_title: item.name || "", line_item_name: item.name || "",
        line_item_quantity: num(item.qty_ordered),
        line_item_price: num(item.price),
        line_item_sku: item.sku || "",
      });
    });
  }
  return rows;
}

export async function fetchMagentoOrders(creds, onProgress, filters = {}) {
  const orders = await searchAll(creds, "orders", onProgress, magentoCriteria("orders", filters));
  return mapMagentoOrders(orders);
}

// ─── coupons → discounts ──────────────────────────────────────────────────────

const M_ACTION = { by_percent: "percentage", by_fixed: "fixed_amount", cart_fixed: "fixed_amount" };

/** Pure: coupons + their cart price rules → discount rows. */
export function mapMagentoCoupons(coupons, rules) {
  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));
  return coupons.map((c) => {
    const r = ruleMap.get(c.rule_id) || {};
    const vt = M_ACTION[r.simple_action];
    if (!vt) return null;
    return {
      command: "MERGE", codes: c.code || "", title: r.name || c.code || "",
      value_type: vt, value: num(r.discount_amount),
      ends_at: r.to_date ? isoDate(r.to_date) : "",
      usage_limit: c.usage_limit ? String(c.usage_limit) : (r.uses_per_coupon ? String(r.uses_per_coupon) : ""),
      once_per_customer: Number(r.uses_per_customer) === 1 ? "TRUE" : "",
      minimum_subtotal: "",
    };
  }).filter(Boolean).filter((r) => r.codes);
}

export async function fetchMagentoCoupons(creds, onProgress) {
  let coupons = [];
  try { coupons = await searchAll(creds, "coupons/search", onProgress); } catch { coupons = []; }
  let rules = [];
  try { rules = await searchAll(creds, "salesRules/search"); } catch { rules = []; }
  return mapMagentoCoupons(coupons, rules);
}

// ─── redirects (generated) ────────────────────────────────────────────────────

/**
 * Pure: old Magento URLs → new Shopify paths. Magento's defaults are
 * `/<url_key>.html` for products and `/<url_path>.html` for categories
 * (the ".html" suffix is Magento's default and can be changed in config —
 * `suffix` lets a caller override it).
 */
export function mapMagentoRedirects({ products, cats, suffix = ".html" }) {
  const rows = [];
  const seen = new Set();
  const push = (path, target) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    rows.push({ command: "MERGE", path, target });
  };
  for (const p of products) {
    if (Number(p.visibility) === 1) continue;
    const key = attr(p, "url_key");
    if (!key) continue;
    push(`/${key}${suffix}`, `/products/${key}`);
  }
  for (const c of cats) {
    if (!c.name || (c.level != null && c.level < 2)) continue;
    const urlPath = attr(c, "url_path") || attr(c, "url_key");
    if (!urlPath) continue;
    const handle = attr(c, "url_key") || slug(c.name);
    push(`/${urlPath}${suffix}`, `/collections/${handle}`);
  }
  return rows;
}

export async function fetchMagentoRedirects(creds, onProgress, filters = {}) {
  const products = await searchAll(creds, "products", onProgress, magentoCriteria("products", filters));
  let cats = [];
  try { cats = await searchAll(creds, "categories/list"); } catch { cats = []; }
  return mapMagentoRedirects({ products, cats });
}
