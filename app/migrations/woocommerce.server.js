/**
 * migrations/woocommerce.server.js
 *
 * WooCommerce REST API (v3) connector. Validates read-only key credentials and
 * pulls products (with variations) + customers, mapping them to the SAME
 * snake_case row shape the app's export normalizer produces — so the workbook
 * we build round-trips straight through the existing import pipeline.
 *
 * Auth: HTTP Basic (consumer key / secret) over HTTPS — the standard read path.
 * Credentials are used transiently for the request; nothing is persisted.
 */

/** `https://shop.com` (+ optional trailing slash) → `https://shop.com/wp-json/wc/v3`. */
function apiBase(siteUrl) {
  const trimmed = String(siteUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Site URL must start with http(s)://");
  return `${trimmed}/wp-json/wc/v3`;
}

function authHeader({ consumerKey, consumerSecret }) {
  return "Basic " + Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
}

/** Read the total-record count for a collection endpoint (from the X-WP-Total header). */
async function countOf(creds, path) {
  try {
    const res = await fetch(`${apiBase(creds.siteUrl)}/${path}?per_page=1`, {
      headers: { Authorization: authHeader(creds) },
    });
    if (!res.ok) return null;
    return Number(res.headers.get("x-wp-total")) || 0;
  } catch { return null; }
}

/** Validate the credentials, then report per-entity counts for the selection step. */
export async function validateWoo(creds) {
  if (!creds.siteUrl || !creds.consumerKey || !creds.consumerSecret) {
    return { ok: false, error: "Fill in the Site URL, consumer key, and consumer secret." };
  }
  let url;
  try { url = `${apiBase(creds.siteUrl)}/products?per_page=1`; }
  catch (e) { return { ok: false, error: e.message }; }

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the store: ${e.message}` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: "Invalid consumer key or secret." };
  if (res.status === 404) return { ok: false, error: "WooCommerce REST API not found at that URL." };
  if (!res.ok) return { ok: false, error: `WooCommerce returned HTTP ${res.status}.` };

  const products = Number(res.headers.get("x-wp-total")) || 0;
  const [customers, orders, collections, discounts] = await Promise.all([
    countOf(creds, "customers"),
    countOf(creds, "orders"),
    countOf(creds, "products/categories"),
    countOf(creds, "coupons"),
  ]);
  return { ok: true, counts: { products, customers, orders, collections, discounts } };
}

const PER_PAGE = 100;
const MAX_PAGES = 500; // safety cap (~50k records/entity)

/** Fetch every page of a WC collection endpoint, calling onPage(batch) as we go. */
async function fetchAll(creds, path, onPage) {
  const base = apiBase(creds.siteUrl);
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base}/${path}${sep}per_page=${PER_PAGE}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
    if (!res.ok) throw new Error(`WooCommerce ${path} returned HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    onPage?.(batch.length);
    if (batch.length < PER_PAGE) break;
  }
  return out;
}

const STATUS_MAP = { publish: "ACTIVE", draft: "DRAFT", pending: "DRAFT", private: "DRAFT" };

// Shopify wants price = selling price, compare-at = the higher original. Woo puts
// the sale price in `sale_price` and the original in `regular_price`.
function pricePair(o) {
  const onSale = o.sale_price && String(o.sale_price).trim() !== "";
  return {
    price: onSale ? o.sale_price : (o.regular_price || o.price || ""),
    compare_at_price: onSale ? (o.regular_price || "") : "",
  };
}

function variantFields(v, attrNames) {
  const val = (i) => {
    const name = attrNames[i];
    const a = (v.attributes || []).find((x) => x.name === name);
    return { name: name || "", value: a?.option || "" };
  };
  const o1 = val(0), o2 = val(1), o3 = val(2);
  return {
    option1_name: o1.name, option1_value: o1.value,
    option2_name: o2.name, option2_value: o2.value,
    option3_name: o3.name, option3_value: o3.value,
    sku: v.sku || "",
    weight: v.weight || "",
    inventory_qty: v.stock_quantity != null ? String(v.stock_quantity) : "",
    ...pricePair(v),
  };
}

/** Pull products (+ variations) → app product rows (Matrixify top-row layout). */
export async function fetchWooProducts(creds, onProgress) {
  const products = await fetchAll(creds, "products?status=any", onProgress);
  const rows = [];
  let rn = 1;

  for (const p of products) {
    const cats = (p.categories || []).map((c) => c.name);
    const images = (p.images || []).map((im) => im.src);
    // Tag products with their categories too, so a category migrated to a smart
    // collection (rule: product tag = category) auto-populates.
    const tags = [...new Set([...(p.tags || []).map((t) => t.name), ...cats])].join(", ");
    const base = {
      command: "MERGE",
      handle: p.slug || "",
      title: p.name || "",
      body_html: p.description || "",
      vendor: "",
      product_type: cats[0] || "",
      tags,
      status: STATUS_MAP[p.status] || "DRAFT",
      published: p.status === "publish" ? "TRUE" : "FALSE",
    };

    if (p.type === "variable") {
      const attrNames = (p.attributes || []).filter((a) => a.variation).map((a) => a.name);
      const variations = await fetchAll(creds, `products/${p.id}/variations`);
      const list = variations.length ? variations : [{}];
      list.forEach((v, i) => {
        rows.push({
          ...(i === 0 ? base : {}),
          top_row: i === 0 ? "TRUE" : "",
          row_number: rn++,
          image_url: i === 0 ? (images[0] || "") : "",
          ...variantFields(v, attrNames),
        });
      });
    } else {
      rows.push({
        ...base,
        top_row: "TRUE",
        row_number: rn++,
        image_url: images[0] || "",
        sku: p.sku || "",
        weight: p.weight || "",
        inventory_qty: p.stock_quantity != null ? String(p.stock_quantity) : "",
        ...pricePair(p),
      });
    }
    // Extra images beyond the first become image-only rows (matches the app's layout).
    images.slice(1).forEach((src) => rows.push({ top_row: "", row_number: rn++, image_url: src }));
  }
  return rows;
}

/** Pull customers → app customer rows (one row each, with the billing address). */
export async function fetchWooCustomers(creds, onProgress) {
  const customers = await fetchAll(creds, "customers?role=all", onProgress);
  let rn = 1;
  return customers
    .map((c) => {
      const b = c.billing || {};
      return {
        command: "MERGE",
        email: c.email || "",
        first_name: c.first_name || b.first_name || "",
        last_name: c.last_name || b.last_name || "",
        phone: b.phone || "",
        address_command: "MERGE",
        address_first_name: b.first_name || "",
        address_last_name: b.last_name || "",
        address_company: b.company || "",
        address_phone: b.phone || "",
        address1: b.address_1 || "",
        address2: b.address_2 || "",
        address_city: b.city || "",
        address_province: b.state || "",
        address_country: b.country || "",
        address_zip: b.postcode || "",
        address_top_row: "TRUE",
        address_row_number: 1,
        top_row: "TRUE",
        row_number: rn++,
      };
    })
    .filter((r) => r.email);
}

// Woo order status → Shopify financial status (must be a valid import value).
const FINANCIAL_MAP = {
  completed: "PAID", processing: "PAID", "on-hold": "PENDING", pending: "PENDING",
  refunded: "REFUNDED", cancelled: "VOIDED", failed: "PENDING",
};

function addressFields(prefix, a = {}) {
  return {
    [`${prefix}_first_name`]: a.first_name || "",
    [`${prefix}_last_name`]: a.last_name || "",
    [`${prefix}_company`]: a.company || "",
    [`${prefix}_phone`]: a.phone || "",
    [`${prefix}_address1`]: a.address_1 || "",
    [`${prefix}_address2`]: a.address_2 || "",
    [`${prefix}_city`]: a.city || "",
    [`${prefix}_province`]: a.state || "",
    [`${prefix}_zip`]: a.postcode || "",
    [`${prefix}_country`]: a.country || "",
  };
}

/**
 * Pull orders → app order rows (Matrixify layout: order-level fields on the
 * first line-item row, then a row per additional line item). Line items carry
 * title + sku + price + qty so orders import even without matched Shopify IDs.
 */
export async function fetchWooOrders(creds, onProgress) {
  const orders = await fetchAll(creds, "orders?status=any", onProgress);
  const rows = [];
  let rn = 1;

  for (const o of orders) {
    const items = (o.line_items || []).filter((li) => li.name);
    if (items.length === 0) continue; // a new order needs at least one line item

    const b = o.billing || {};
    const orderTop = {
      command: "NEW",
      order_name: o.number ? `#${o.number}` : "",
      email: b.email || "",
      phone: b.phone || "",
      note: o.customer_note || "",
      financial_status: FINANCIAL_MAP[o.status] || "PENDING",
      fulfillment_status: o.status === "completed" ? "FULFILLED" : "",
      currency: o.currency || "",
      created_at: o.date_created || "",
      processed_at: o.date_paid || o.date_created || "",
      total_price: o.total || "",
      ...addressFields("billing", o.billing),
      ...addressFields("shipping", o.shipping),
      shipping_line_title: (o.shipping_lines || [])[0]?.method_title || "",
      shipping_line_price: (o.shipping_lines || [])[0]?.total || "",
    };

    items.forEach((li, i) => {
      const unit = li.price != null ? li.price
        : (li.quantity ? Number(li.total) / Number(li.quantity) : li.total);
      rows.push({
        ...(i === 0 ? orderTop : {}),
        line_type: "Line Item",
        top_row: i === 0 ? "TRUE" : "",
        row_number: rn++,
        line_item_title: li.name || "",
        line_item_name: li.name || "",
        line_item_quantity: li.quantity != null ? String(li.quantity) : "",
        line_item_price: unit != null && unit !== "" ? String(unit) : "",
        line_item_sku: li.sku || "",
      });
    });
  }
  return rows;
}

/**
 * Pull product categories → smart collection rows. Each becomes a smart
 * collection with a "product tag = <category name>" rule, so it auto-populates
 * from the products (which are tagged with their categories on migration).
 */
export async function fetchWooCategories(creds, onProgress) {
  const cats = await fetchAll(creds, "products/categories", onProgress);
  return cats.map((c) => ({
    command: "MERGE",
    handle: c.slug || "",
    title: c.name || "",
    body_html: c.description || "",
    collection_type: "smart",
    rules_match: "any",
    rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: c.name || "" }]),
    image_url: c.image?.src || "",
  })).filter((r) => r.title);
}

const COUPON_TYPE = { percent: "percentage", fixed_cart: "fixed_amount", fixed_product: "fixed_amount" };

/** Pull coupons → basic code discount rows. */
export async function fetchWooCoupons(creds, onProgress) {
  const coupons = await fetchAll(creds, "coupons", onProgress);
  return coupons.map((c) => ({
    command: "MERGE",
    codes: c.code || "",
    title: c.code || "",
    value_type: COUPON_TYPE[c.discount_type] || "fixed_amount",
    value: c.amount || "",
    ends_at: c.date_expires || "",
    usage_limit: c.usage_limit != null ? String(c.usage_limit) : "",
    once_per_customer: c.individual_use ? "TRUE" : "",
    minimum_subtotal: c.minimum_amount && Number(c.minimum_amount) > 0 ? String(c.minimum_amount) : "",
  })).filter((r) => r.codes);
}
