/**
 * migrations/bigcommerce.server.js
 *
 * BigCommerce connector. Validates a store API token and pulls products (with
 * variants + images), categories→collections, customers (with address), orders
 * (V2 + line items), and coupons→discounts — mapped to the app's row shape so
 * the workbook round-trips through the import pipeline, exactly like the Woo
 * connector.
 *
 * Auth: `X-Auth-Token` header. Catalog/customers use the V3 API, orders/coupons
 * use V2. Credentials are used transiently; nothing is persisted.
 */

function v3(creds) { return `https://api.bigcommerce.com/stores/${String(creds.storeHash || "").trim()}/v3`; }
function v2(creds) { return `https://api.bigcommerce.com/stores/${String(creds.storeHash || "").trim()}/v2`; }
function headers(creds) {
  return { "X-Auth-Token": creds.accessToken, Accept: "application/json", "Content-Type": "application/json" };
}

const PER_PAGE = 250;
const MAX_PAGES = 500;

/** V3 endpoints: `{ data, meta.pagination }`. */
async function getV3All(creds, path, onProgress) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${v3(creds)}/${path}${sep}limit=${PER_PAGE}&page=${page}`, { headers: headers(creds) });
    if (!res.ok) throw new Error(`BigCommerce ${path} returned HTTP ${res.status}`);
    const body = await res.json();
    const data = body.data || [];
    out.push(...data);
    onProgress?.(data.length);
    const totalPages = body.meta?.pagination?.total_pages ?? 1;
    if (page >= totalPages || data.length === 0) break;
  }
  return out;
}

/** V2 endpoints: bare arrays, 204 when empty. */
async function getV2All(creds, path, onProgress) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${v2(creds)}/${path}${sep}limit=${PER_PAGE}&page=${page}`, { headers: headers(creds) });
    if (res.status === 204) break;
    if (!res.ok) throw new Error(`BigCommerce ${path} returned HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    onProgress?.(data.length);
    if (data.length < PER_PAGE) break;
  }
  return out;
}

async function countV3(creds, path) {
  try {
    const res = await fetch(`${v3(creds)}/${path}?limit=1`, { headers: headers(creds) });
    if (!res.ok) return null;
    return (await res.json()).meta?.pagination?.total ?? null;
  } catch { return null; }
}
async function countV2Orders(creds) {
  try {
    const res = await fetch(`${v2(creds)}/orders/count`, { headers: headers(creds) });
    if (!res.ok) return null;
    return (await res.json()).count ?? null;
  } catch { return null; }
}

export async function validateBigC(creds) {
  if (!creds.storeHash || !creds.accessToken) {
    return { ok: false, error: "Fill in the store hash and access token." };
  }
  let res;
  try {
    res = await fetch(`${v3(creds)}/catalog/products?limit=1`, { headers: headers(creds) });
  } catch (e) {
    return { ok: false, error: `Couldn't reach BigCommerce: ${e.message}` };
  }
  if (res.status === 401) return { ok: false, error: "Invalid access token." };
  if (res.status === 404) return { ok: false, error: "Store not found — check the store hash." };
  if (!res.ok) return { ok: false, error: `BigCommerce returned HTTP ${res.status}.` };

  const products = (await res.json()).meta?.pagination?.total ?? 0;
  const [collections, customers, orders] = await Promise.all([
    countV3(creds, "catalog/categories"),
    countV3(creds, "customers"),
    countV2Orders(creds),
  ]);
  return { ok: true, counts: { products, customers, orders, collections } };
}

// ─── mapping helpers ───────────────────────────────────────────────────────────

function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function handleFrom(o) {
  const u = o.custom_url?.url;
  return u ? String(u).replace(/^\/+|\/+$/g, "") : slug(o.name);
}
function isoDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
// BigCommerce: price = regular, sale_price = sale (0 when none).
function pricePair(o) {
  const price = Number(o.price || 0);
  const sale = Number(o.sale_price || 0);
  const onSale = sale > 0 && sale < price;
  return {
    price: onSale ? String(sale) : (o.price != null ? String(o.price) : ""),
    compare_at_price: onSale ? String(price) : "",
  };
}
function bcVariant(v) {
  const ov = v.option_values || [];
  const opt = (i) => ({ name: ov[i]?.option_display_name || "", value: ov[i]?.label || "" });
  const o1 = opt(0), o2 = opt(1), o3 = opt(2);
  return {
    option1_name: o1.name, option1_value: o1.value,
    option2_name: o2.name, option2_value: o2.value,
    option3_name: o3.name, option3_value: o3.value,
    sku: v.sku || "",
    inventory_qty: v.inventory_level != null ? String(v.inventory_level) : "",
    ...pricePair(v),
  };
}

async function categoryNameMap(creds) {
  const cats = await getV3All(creds, "catalog/categories");
  return new Map(cats.map((c) => [c.id, c.name]));
}

// ─── fetchers ───────────────────────────────────────────────────────────────────

export async function fetchBigCProducts(creds, onProgress) {
  const catMap = await categoryNameMap(creds);
  const products = await getV3All(creds, "catalog/products?include=variants,images", onProgress);
  const rows = [];
  let rn = 1;

  for (const p of products) {
    const catNames = (p.categories || []).map((id) => catMap.get(id)).filter(Boolean);
    const images = (p.images || [])
      .slice().sort((a, b) => (b.is_thumbnail ? 1 : 0) - (a.is_thumbnail ? 1 : 0))
      .map((im) => im.url_standard).filter(Boolean);
    // Tag with categories so category→smart-collection membership works.
    const base = {
      command: "MERGE", handle: handleFrom(p), title: p.name || "", body_html: p.description || "",
      vendor: "", product_type: catNames[0] || "", tags: catNames.join(", "),
      status: p.is_visible ? "ACTIVE" : "DRAFT", published: p.is_visible ? "TRUE" : "FALSE",
    };
    const variants = p.variants || [];

    if (variants.length > 1) {
      variants.forEach((v, i) => {
        rows.push({
          ...(i === 0 ? base : {}),
          top_row: i === 0 ? "TRUE" : "", row_number: rn++,
          image_url: i === 0 ? (images[0] || "") : "",
          ...bcVariant(v),
        });
      });
    } else {
      const v = variants[0] || {};
      rows.push({
        ...base, top_row: "TRUE", row_number: rn++, image_url: images[0] || "",
        sku: v.sku || p.sku || "",
        weight: p.weight != null ? String(p.weight) : "",
        inventory_qty: (v.inventory_level ?? p.inventory_level) != null ? String(v.inventory_level ?? p.inventory_level) : "",
        ...pricePair(v.price != null ? v : p),
      });
    }
    images.slice(1).forEach((src) => rows.push({ top_row: "", row_number: rn++, image_url: src }));
  }
  return rows;
}

export async function fetchBigCCategories(creds, onProgress) {
  const cats = await getV3All(creds, "catalog/categories", onProgress);
  return cats.map((c) => ({
    command: "MERGE",
    handle: c.custom_url?.url ? String(c.custom_url.url).replace(/^\/+|\/+$/g, "") : slug(c.name),
    title: c.name || "",
    body_html: c.description || "",
    collection_type: "smart",
    rules_match: "any",
    rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: c.name || "" }]),
    image_url: c.image_url || "",
  })).filter((r) => r.title);
}

export async function fetchBigCCustomers(creds, onProgress) {
  const customers = await getV3All(creds, "customers", onProgress);
  let addrs = [];
  try { addrs = await getV3All(creds, "customers/addresses"); } catch { addrs = []; }
  const byCustomer = new Map();
  for (const a of addrs) if (!byCustomer.has(a.customer_id)) byCustomer.set(a.customer_id, a);

  let rn = 1;
  return customers.map((c) => {
    const a = byCustomer.get(c.id) || {};
    return {
      command: "MERGE",
      email: c.email || "", first_name: c.first_name || "", last_name: c.last_name || "", phone: c.phone || a.phone || "",
      address_command: "MERGE",
      address_first_name: a.first_name || c.first_name || "", address_last_name: a.last_name || c.last_name || "",
      address_company: a.company || c.company || "", address_phone: a.phone || "",
      address1: a.address1 || "", address2: a.address2 || "",
      address_city: a.city || "", address_province: a.state_or_province || "",
      address_country: a.country || "", address_zip: a.postal_code || "",
      address_top_row: "TRUE", address_row_number: 1, top_row: "TRUE", row_number: rn++,
    };
  }).filter((r) => r.email);
}

const BC_FINANCIAL = {
  Completed: "PAID", Shipped: "PAID", "Partially Shipped": "PAID", "Awaiting Fulfillment": "PAID", "Awaiting Pickup": "PAID",
  Pending: "PENDING", "Awaiting Payment": "PENDING",
  Refunded: "REFUNDED", "Partially Refunded": "PARTIALLY_REFUNDED",
  Cancelled: "VOIDED", Declined: "VOIDED",
};

export async function fetchBigCOrders(creds, onProgress) {
  const orders = await getV2All(creds, "orders", onProgress);
  const rows = [];
  let rn = 1;

  for (const o of orders) {
    let items = [];
    try { items = await getV2All(creds, `orders/${o.id}/products`); } catch { items = []; }
    const li = items.filter((x) => x.name);
    if (li.length === 0) continue;

    const b = o.billing_address || {};
    const top = {
      command: "NEW",
      order_name: o.id ? `#${o.id}` : "",
      email: b.email || "", phone: b.phone || "",
      financial_status: BC_FINANCIAL[o.status] || "PENDING",
      fulfillment_status: (o.status === "Completed" || o.status === "Shipped") ? "FULFILLED" : "",
      currency: o.currency_code || "",
      created_at: isoDate(o.date_created),
      total_price: o.total_inc_tax || "",
      billing_first_name: b.first_name || "", billing_last_name: b.last_name || "", billing_company: b.company || "", billing_phone: b.phone || "",
      billing_address1: b.street_1 || "", billing_address2: b.street_2 || "",
      billing_city: b.city || "", billing_province: b.state || "", billing_zip: b.zip || "", billing_country: b.country || "",
    };

    li.forEach((item, i) => {
      rows.push({
        ...(i === 0 ? top : {}),
        line_type: "Line Item", top_row: i === 0 ? "TRUE" : "", row_number: rn++,
        line_item_title: item.name || "", line_item_name: item.name || "",
        line_item_quantity: item.quantity != null ? String(item.quantity) : "",
        line_item_price: item.base_price != null ? String(item.base_price)
          : (item.price_inc_tax != null ? String(item.price_inc_tax) : ""),
        line_item_sku: item.sku || "",
      });
    });
  }
  return rows;
}

const BC_COUPON_TYPE = {
  percentage_discount: "percentage", per_total_discount: "fixed_amount", per_item_discount: "fixed_amount",
};

export async function fetchBigCCoupons(creds, onProgress) {
  const coupons = await getV2All(creds, "coupons", onProgress);
  return coupons
    .filter((c) => BC_COUPON_TYPE[c.type])
    .map((c) => ({
      command: "MERGE",
      codes: c.code || "",
      title: c.name || c.code || "",
      value_type: BC_COUPON_TYPE[c.type],
      value: c.amount || "",
      ends_at: c.expires ? isoDate(c.expires) : "",
      usage_limit: c.max_uses ? String(c.max_uses) : "",
      once_per_customer: Number(c.max_uses_per_customer) === 1 ? "TRUE" : "",
      minimum_subtotal: c.min_purchase && Number(c.min_purchase) > 0 ? String(c.min_purchase) : "",
    }))
    .filter((r) => r.codes);
}
