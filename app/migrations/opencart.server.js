/**
 * migrations/opencart.server.js
 *
 * OpenCart connector. OpenCart's built-in API (4.x) is checkout-only — there is
 * no route that lists products, customers or orders — so, like every OpenCart
 * migration tool, we read through a small PHP "bridge" file the merchant drops
 * into their store root (see opencart-bridge.php.template). The bridge is
 * read-only, token-guarded, and serves paginated JSON per entity; this module
 * pages through it and maps the records to the app's import sheets.
 *
 * creds = { siteUrl, bridgeToken }
 */

const BRIDGE_FILE = "syncifypro-bridge.php";
const PAGE = 100;
const MAX_PAGES = 2000;

function base(creds) {
  return String(creds.siteUrl || "").trim().replace(/\/+$/, "").replace(new RegExp(`/${BRIDGE_FILE}$`), "");
}
function bridgeUrl(creds, params) {
  const q = new URLSearchParams(params);
  return `${base(creds)}/${BRIDGE_FILE}?${q.toString()}`;
}

async function call(creds, params) {
  const res = await fetch(bridgeUrl(creds, params), {
    headers: { "X-Syncifypro-Token": String(creds.bridgeToken || "").trim(), Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error(res.status === 404
      ? `Bridge file not found at ${base(creds)}/${BRIDGE_FILE} — upload it to your OpenCart root folder.`
      : `The bridge returned something that isn't JSON (HTTP ${res.status}). Check the store URL.`);
  }
  if (res.status === 401) throw new Error("Bridge token doesn't match — download the bridge file again and re-upload it.");
  if (!res.ok) throw new Error(body?.error || `OpenCart bridge returned HTTP ${res.status}.`);
  return body;
}

/** Page through a list entity; returns every record (optionally filtered by `keep`). */
async function fetchAll(creds, entity, onProgress, keep = () => true) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await call(creds, { entity, page, limit: PAGE });
    const data = Array.isArray(body.data) ? body.data : [];
    for (const r of data) if (keep(r)) out.push(r);
    onProgress?.(data.length);
    if (!body.has_more || data.length === 0) break;
  }
  return out;
}

// ─── filters (applied client-side — the bridge only knows updated_since) ───────

const day = (v) => (typeof v === "string" && v.trim() ? new Date(`${v.trim()}T00:00:00Z`) : null);
const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const inRange = (iso, after, before) => {
  if (!after && !before) return true;
  const t = iso ? new Date(String(iso).replace(" ", "T") + (String(iso).includes("T") || String(iso).length <= 10 ? "" : "Z")).getTime() : NaN;
  if (Number.isNaN(t)) return false;
  return (!after || t >= after.getTime()) && (!before || t < before.getTime());
};

/** Predicate that keeps the records matching the migration filters for `entity`. */
export function ocKeep(entity, filters = {}) {
  if (entity === "products") {
    const st = new Set(list(filters.product_status).map((s) => s.toLowerCase()));
    const cA = day(filters.product_created_after), cB = day(filters.product_created_before);
    const uA = day(filters.product_updated_after), uB = day(filters.product_updated_before);
    return (p) => (!st.size || st.has(p.status ? "enabled" : "disabled"))
      && inRange(p.date_added, cA, cB) && inRange(p.date_modified, uA, uB);
  }
  if (entity === "orders") {
    const st = new Set(list(filters.order_status).map((s) => s.toLowerCase()));
    const cA = day(filters.order_created_after), cB = day(filters.order_created_before);
    const uA = day(filters.order_updated_after), uB = day(filters.order_updated_before);
    return (o) => (!st.size || st.has(String(o.status || "").toLowerCase()))
      && inRange(o.date_added, cA, cB) && inRange(o.date_modified, uA, uB);
  }
  if (entity === "customers") {
    const cA = day(filters.customer_created_after), cB = day(filters.customer_created_before);
    return (c) => inRange(c.date_added, cA, cB);
  }
  return () => true;
}

// ─── validate ──────────────────────────────────────────────────────────────────

export async function validateOpenCart(creds) {
  if (!creds.siteUrl) return { ok: false, error: "Fill in the store URL." };
  if (!/^https?:\/\//i.test(String(creds.siteUrl).trim())) return { ok: false, error: "Store URL must start with http(s)://" };
  if (!creds.bridgeToken) return { ok: false, error: "Download the bridge file first — it carries the token." };
  let ping;
  try {
    ping = await call(creds, { entity: "ping" });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!ping?.ok) return { ok: false, error: ping?.error || "The bridge didn't answer correctly." };
  const c = ping.counts || {};
  return {
    ok: true,
    label: ping.store_name || undefined,
    counts: { products: c.products ?? null, customers: c.customers ?? null, orders: c.orders ?? null, collections: c.categories ?? null, discounts: c.coupons ?? null },
  };
}

// ─── mapping helpers ───────────────────────────────────────────────────────────

function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function isoDate(v) {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
const money = (v) => (v == null || v === "" ? "" : String(Number(v)));
const MAX_VARIANTS = 100;

/** Cartesian product of the product's choice options (select/radio), capped. */
function variantCombos(options) {
  const choice = (options || [])
    .filter((o) => ["select", "radio"].includes(String(o.type)) && Array.isArray(o.values) && o.values.length)
    .slice(0, 3);
  if (!choice.length) return [];
  let combos = [[]];
  for (const o of choice) {
    const next = [];
    for (const c of combos) for (const v of o.values) next.push([...c, { option: o.name, value: v.name, mod: Number(v.price_modifier || 0), qty: v.quantity }]);
    combos = next;
    if (combos.length > MAX_VARIANTS) break;
  }
  return combos.slice(0, MAX_VARIANTS);
}

// ─── fetchers ──────────────────────────────────────────────────────────────────

export async function fetchOpenCartProducts(creds, onProgress, filters = {}) {
  const keep = ocKeep("products", filters);
  // OpenCart 4 "variant" children mirror their master's options — the master
  // row (with its combos) already covers them.
  const products = await fetchAll(creds, "products", onProgress, (p) => !p.is_variant && keep(p));
  const rows = [];
  let rn = 1;
  for (const p of products) {
    const cats = (p.categories || []).filter(Boolean);
    const tags = [...new Set([...cats, ...String(p.tags || "").split(",").map((t) => t.trim()).filter(Boolean)])].join(", ");
    const base = {
      command: "MERGE",
      handle: p.seo_keyword || slug(p.name) || `product-${p.product_id}`,
      title: p.name || "", body_html: p.description || "",
      vendor: p.manufacturer || "", product_type: cats[0] || "", tags,
      status: p.status ? "ACTIVE" : "DRAFT", published: p.status ? "TRUE" : "FALSE",
    };
    const price = Number(p.price || 0);
    const special = p.special_price != null && Number(p.special_price) < price ? Number(p.special_price) : null;
    const sellPrice = special ?? price;
    const compareAt = special != null ? price : null;
    const common = { sku: p.sku || p.model || "", weight: p.weight != null ? String(p.weight) : "" };
    const combos = variantCombos(p.options);

    if (combos.length) {
      combos.forEach((combo, i) => {
        const mod = combo.reduce((s, c) => s + c.mod, 0);
        const row = {
          ...(i === 0 ? base : {}),
          top_row: i === 0 ? "TRUE" : "", row_number: rn++, image_url: i === 0 ? (p.image || "") : "",
          ...common,
          price: money(sellPrice + mod), compare_at_price: compareAt != null ? money(compareAt + mod) : "",
          inventory_qty: combo.length === 1 && combo[0].qty != null ? String(combo[0].qty) : (p.quantity != null ? String(p.quantity) : ""),
        };
        combo.forEach((c, k) => { row[`option${k + 1}_name`] = c.option; row[`option${k + 1}_value`] = c.value; });
        rows.push(row);
      });
    } else {
      rows.push({
        ...base, top_row: "TRUE", row_number: rn++, image_url: p.image || "", ...common,
        price: money(sellPrice), compare_at_price: compareAt != null ? money(compareAt) : "",
        inventory_qty: p.quantity != null ? String(p.quantity) : "",
      });
    }
    (p.additional_images || []).forEach((src) => rows.push({ top_row: "", row_number: rn++, image_url: src }));
  }
  return rows;
}

export async function fetchOpenCartCategories(creds, onProgress) {
  const cats = await fetchAll(creds, "categories", onProgress);
  return cats.filter((c) => c.name).map((c) => ({
    command: "MERGE",
    handle: c.seo_keyword || slug(c.path || c.name),
    title: c.name, body_html: c.description || "",
    collection_type: "smart", rules_match: "any",
    rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: c.name }]),
    image_url: c.image || "",
  }));
}

export async function fetchOpenCartCustomers(creds, onProgress, filters = {}) {
  const customers = await fetchAll(creds, "customers", onProgress, ocKeep("customers", filters));
  let rn = 1;
  return customers.filter((c) => c.email).map((c) => {
    const a = (c.addresses || []).find((x) => x.default) || (c.addresses || [])[0] || {};
    return {
      command: "MERGE",
      email: c.email, first_name: c.firstname || "", last_name: c.lastname || "", phone: c.telephone || "",
      address_command: "MERGE",
      address_first_name: a.firstname || c.firstname || "", address_last_name: a.lastname || c.lastname || "",
      address_company: a.company || "", address_phone: c.telephone || "",
      address1: a.address_1 || "", address2: a.address_2 || "", address_city: a.city || "",
      address_province: a.zone || "", address_country: a.country_code || a.country || "", address_zip: a.postcode || "",
      address_top_row: "TRUE", address_row_number: 1, top_row: "TRUE", row_number: rn++,
    };
  });
}

const OC_FINANCIAL = {
  pending: "PENDING", processing: "PAID", processed: "PAID", shipped: "PAID", complete: "PAID", completed: "PAID",
  canceled: "VOIDED", cancelled: "VOIDED", "canceled reversal": "VOIDED", denied: "VOIDED", expired: "VOIDED",
  failed: "VOIDED", voided: "VOIDED", refunded: "REFUNDED", reversed: "REFUNDED", chargeback: "REFUNDED",
};
const OC_FULFILLED = new Set(["shipped", "complete", "completed"]);

export async function fetchOpenCartOrders(creds, onProgress, filters = {}) {
  const orders = await fetchAll(creds, "orders", onProgress, ocKeep("orders", filters));
  const rows = [];
  let rn = 1;
  for (const o of orders) {
    const items = (o.line_items || []).filter((x) => x.name);
    if (!items.length) continue;
    const st = String(o.status || "").toLowerCase();
    const b = o.payment_address || {}, s = o.shipping_address || {};
    const top = {
      command: "NEW",
      order_name: o.order_id ? `#${o.order_id}` : "",
      email: o.email || o.customer?.email || "", phone: o.customer?.telephone || "",
      note: o.comment || "",
      financial_status: OC_FINANCIAL[st] || "PENDING",
      fulfillment_status: OC_FULFILLED.has(st) ? "FULFILLED" : "",
      currency: o.currency_code || "", created_at: isoDate(o.date_added), processed_at: isoDate(o.date_added),
      total_price: money(o.total),
      billing_first_name: b.firstname || "", billing_last_name: b.lastname || "", billing_company: b.company || "",
      billing_phone: o.customer?.telephone || "",
      billing_address1: b.address_1 || "", billing_address2: b.address_2 || "", billing_city: b.city || "",
      billing_province: b.zone || "", billing_zip: b.postcode || "", billing_country: b.country || "",
      shipping_first_name: s.firstname || "", shipping_last_name: s.lastname || "", shipping_company: s.company || "",
      shipping_phone: o.customer?.telephone || "",
      shipping_address1: s.address_1 || "", shipping_address2: s.address_2 || "", shipping_city: s.city || "",
      shipping_province: s.zone || "", shipping_zip: s.postcode || "", shipping_country: s.country || "",
      shipping_line_title: o.shipping_method?.name || "", shipping_line_price: money(o.shipping_total),
    };
    items.forEach((it, i) => {
      const opts = (it.options || []).map((x) => `${x.name}: ${x.value}`).join(" / ");
      rows.push({
        ...(i === 0 ? top : {}),
        line_type: "Line Item", top_row: i === 0 ? "TRUE" : "", row_number: rn++,
        line_item_title: it.name || "", line_item_name: opts ? `${it.name} - ${opts}` : (it.name || ""),
        line_item_quantity: it.quantity != null ? String(it.quantity) : "",
        line_item_price: money(it.price), line_item_sku: it.model || "",
      });
    });
  }
  return rows;
}

export async function fetchOpenCartCoupons(creds, onProgress) {
  const coupons = await fetchAll(creds, "coupons", onProgress);
  return coupons.filter((c) => c.code).map((c) => {
    const pct = String(c.type).toUpperCase() === "P";
    return {
      command: "MERGE", codes: c.code, title: c.name || c.code,
      value_type: pct ? "percentage" : "fixed_amount", value: money(c.discount),
      ends_at: c.date_end && c.date_end !== "0000-00-00" ? isoDate(`${c.date_end} 23:59:59`) : "",
      usage_limit: c.uses_total ? String(c.uses_total) : "",
      once_per_customer: Number(c.uses_customer) === 1 ? "TRUE" : "",
      minimum_subtotal: c.minimum_total && Number(c.minimum_total) > 0 ? money(c.minimum_total) : "",
    };
  }).filter((r) => Number(r.value) > 0);
}
