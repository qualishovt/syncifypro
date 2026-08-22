/**
 * migrations/run.server.js
 *
 * Orchestrates a migration: pull the chosen entities from the source platform,
 * build a multi-sheet .xlsx in the app's own export layout, and stage it to R2
 * under the shop's imports/ prefix. The route then hands the staged key to the
 * existing Import page — so mapping, filters, the background job, and the
 * results workbook all come for free.
 *
 * Each platform is a connector: `{ validate, fetch: { <entity>: fn } }`. Adding
 * a platform is just another entry — every entity reuses the shared sheet specs.
 */

import { toExcelWorkbook } from "../export/formats/excel.js";
import { putToR2 } from "../export/delivery/r2.js";
import {
  validateWoo, fetchWooProducts, fetchWooCustomers, fetchWooOrders,
  fetchWooCategories, fetchWooCoupons, fetchWooRedirects,
} from "./woocommerce.server.js";
import {
  validateBigC, fetchBigCProducts, fetchBigCCustomers, fetchBigCOrders,
  fetchBigCCategories, fetchBigCCoupons,
} from "./bigcommerce.server.js";
import {
  validateMagento, fetchMagentoProducts, fetchMagentoCustomers, fetchMagentoOrders,
  fetchMagentoCategories, fetchMagentoCoupons, fetchMagentoRedirects,
} from "./magento.server.js";
import {
  validatePresta, fetchPrestaProducts, fetchPrestaCustomers, fetchPrestaOrders,
  fetchPrestaCategories, fetchPrestaCoupons,
} from "./prestashop.server.js";
import {
  validateOpenCart, fetchOpenCartProducts, fetchOpenCartCustomers, fetchOpenCartOrders,
  fetchOpenCartCategories, fetchOpenCartCoupons,
} from "./opencart.server.js";
import { fetchEtsyProducts, fetchEtsyCollections, fetchEtsyOrders, refreshAccessToken, etsyKeystring } from "./etsy.server.js";
import { getEtsyConnection, saveEtsyConnection } from "../db/etsyConnection.server.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Per-entity sheet spec — snake_case column keys; the workbook writer humanizes
// the headers, so the file is indistinguishable from an app export and imports.
const SHEET_SPECS = {
  products: {
    name: "Products",
    columns: ["command", "handle", "title", "body_html", "vendor", "product_type", "tags",
      "status", "published", "image_url",
      "option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value",
      "sku", "weight", "price", "compare_at_price", "inventory_qty", "row_number", "top_row"],
  },
  customers: {
    name: "Customers",
    columns: ["command", "email", "first_name", "last_name", "phone",
      "address_command", "address_first_name", "address_last_name", "address_company", "address_phone",
      "address1", "address2", "address_city", "address_province", "address_country", "address_zip",
      "address_row_number", "address_top_row", "row_number", "top_row"],
  },
  orders: {
    name: "Orders",
    columns: ["command", "line_type", "order_name", "email", "phone", "note",
      "financial_status", "fulfillment_status", "currency", "created_at", "processed_at", "total_price",
      "billing_first_name", "billing_last_name", "billing_company", "billing_phone",
      "billing_address1", "billing_address2", "billing_city", "billing_province", "billing_zip", "billing_country",
      "shipping_first_name", "shipping_last_name", "shipping_company", "shipping_phone",
      "shipping_address1", "shipping_address2", "shipping_city", "shipping_province", "shipping_zip", "shipping_country",
      "shipping_line_title", "shipping_line_price",
      "line_item_title", "line_item_name", "line_item_quantity", "line_item_price", "line_item_sku",
      "row_number", "top_row"],
  },
  collections: {
    name: "Collections",
    columns: ["command", "handle", "title", "body_html", "collection_type", "rules_match", "rules", "image_url"],
  },
  discounts: {
    name: "Discounts",
    columns: ["command", "codes", "title", "value_type", "value", "ends_at", "usage_limit",
      "once_per_customer", "minimum_subtotal"],
  },
  // Generated (not migrated): old platform URL paths → the same handles in
  // Shopify, so old links and search rankings survive the move.
  redirects: {
    name: "Redirects",
    columns: ["command", "path", "target"],
  },
};

// Canonical order: products before collections so products get tagged with their
// categories first (smart collections then auto-populate from those tags).
const ENTITY_ORDER = ["products", "customers", "orders", "collections", "discounts", "redirects"];

const CONNECTORS = {
  woocommerce: {
    validate: validateWoo,
    fetch: {
      products: fetchWooProducts, customers: fetchWooCustomers, orders: fetchWooOrders,
      collections: fetchWooCategories, discounts: fetchWooCoupons, redirects: fetchWooRedirects,
    },
  },
  bigcommerce: {
    validate: validateBigC,
    fetch: {
      products: fetchBigCProducts, customers: fetchBigCCustomers, orders: fetchBigCOrders,
      collections: fetchBigCCategories, discounts: fetchBigCCoupons,
    },
  },
  magento: {
    validate: validateMagento,
    fetch: {
      products: fetchMagentoProducts, customers: fetchMagentoCustomers, orders: fetchMagentoOrders,
      collections: fetchMagentoCategories, discounts: fetchMagentoCoupons, redirects: fetchMagentoRedirects,
    },
  },
  prestashop: {
    validate: validatePresta,
    fetch: {
      products: fetchPrestaProducts, customers: fetchPrestaCustomers, orders: fetchPrestaOrders,
      collections: fetchPrestaCategories, discounts: fetchPrestaCoupons,
    },
  },
  opencart: {
    validate: validateOpenCart,
    fetch: {
      products: fetchOpenCartProducts, customers: fetchOpenCartCustomers, orders: fetchOpenCartOrders,
      collections: fetchOpenCartCategories, discounts: fetchOpenCartCoupons,
    },
  },
  etsy: {
    // Etsy connects via OAuth (no Connect-button validate); data calls use the
    // stored connection, passed in as `creds` by the route.
    validate: async () => ({ ok: true }),
    fetch: {
      products: fetchEtsyProducts, collections: fetchEtsyCollections, orders: fetchEtsyOrders,
    },
  },
};

/**
 * Load the shop's Etsy connection, refreshing the access token when it's within
 * a minute of expiry (persisting the new tokens). Returns the connection to pass
 * as `creds` to runMigration.
 */
export async function prepareEtsyConnection(shop) {
  const stored = await getEtsyConnection(shop);
  if (!stored) throw new Error("Connect your Etsy account first.");
  // The app-level keystring is ours; prefer the current server value over the
  // one stored at connect time so a rotated key keeps old connections working.
  const conn = { ...stored, keystring: etsyKeystring() || stored.keystring };
  if (new Date(conn.expiresAt).getTime() - Date.now() > 60_000) return conn;

  const t = await refreshAccessToken({ keystring: conn.keystring, refreshToken: conn.refreshToken });
  const fresh = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || conn.refreshToken,
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
  };
  await saveEtsyConnection({
    shop, keystring: conn.keystring, ...fresh,
    etsyShopId: conn.etsyShopId, etsyShopName: conn.etsyShopName,
  });
  return { ...conn, ...fresh };
}

/** Validate a platform's credentials (used by the "Connect" step). */
export async function validateConnection(platform, creds) {
  const conn = CONNECTORS[platform];
  if (!conn) return { ok: false, error: "That platform isn’t connected yet." };
  return conn.validate(creds);
}

/**
 * Run a migration and stage the resulting import file.
 * @returns {Promise<{ key: string, name: string, sheets: {entity: string, count: number}[] }>}
 */
export async function runMigration({ platform, creds, entities, shop, filters = {} }) {
  const conn = CONNECTORS[platform];
  if (!conn) throw new Error("That platform isn’t connected yet.");

  const want = new Set(entities);
  const sheets = [];
  for (const entity of ENTITY_ORDER) {
    if (!want.has(entity)) continue;
    const fetchFn = conn.fetch[entity];
    const spec = SHEET_SPECS[entity];
    if (!fetchFn || !spec) continue;
    // Filters limit what the source sends back (connectors that don't
    // support them just ignore the third argument).
    const rows = await fetchFn(creds, undefined, filters);
    if (rows.length) sheets.push({ name: spec.name, rows, columns: spec.columns });
  }

  if (sheets.length === 0) throw new Error("No records found to migrate for the selected data.");

  const buffer = toExcelWorkbook(sheets);
  const { fileStamp } = await import("../utils/fileStamp.js");
  const stamp = fileStamp();
  const name = `${platform}-migration-${stamp}.xlsx`;
  const key = `imports/${shop}/migrations/${stamp}-${platform}.xlsx`;
  await putToR2({ buffer, key, mimeType: XLSX_MIME });

  return { key, name, sheets: sheets.map((s) => ({ entity: s.name, count: s.rows.length })) };
}
