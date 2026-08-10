/**
 * export/formats/shopifyCsv.js
 *
 * Shopify-NATIVE CSV dialect — the column layout Shopify's own admin
 * importer expects, as opposed to this app's richer native dialect.
 * Use it to hand a file to Shopify's built-in importer, another Shopify
 * store, or a tool that only speaks Shopify's format.
 *
 * Only the entities Shopify itself supports have a native layout
 * (products, customers); anything else falls back to the app's dialect so
 * a multi-entity export never loses a sheet.
 *
 * Products follow Shopify's one-row-per-variant convention: the product
 * columns are written on the record's FIRST row and left blank on the
 * following variant rows (Handle repeats to tie them together).
 */

import { Buffer } from "node:buffer";
import { toCSV } from "./csv.js";

/** [shopifyColumn, sourceKey, scope] — scope "product" blanks on non-top rows. */
const PRODUCT_MAP = [
  ["Handle", "handle", "always"],
  ["Title", "title", "product"],
  ["Body (HTML)", "body_html", "product"],
  ["Vendor", "vendor", "product"],
  ["Product Category", "product_category", "product"],
  ["Type", "product_type", "product"],
  ["Tags", "tags", "product"],
  ["Published", "published", "product"],
  ["Option1 Name", "option1_name", "product"],
  ["Option1 Value", "option1_value", "variant"],
  ["Option2 Name", "option2_name", "product"],
  ["Option2 Value", "option2_value", "variant"],
  ["Option3 Name", "option3_name", "product"],
  ["Option3 Value", "option3_value", "variant"],
  ["Variant SKU", "variant_sku", "variant"],
  ["Variant Grams", "variant_grams", "variant"],
  ["Variant Inventory Tracker", "variant_inventory_tracker", "variant"],
  ["Variant Inventory Qty", "variant_inventory_qty", "variant"],
  ["Variant Inventory Policy", "variant_inventory_policy", "variant"],
  ["Variant Fulfillment Service", "variant_fulfillment_service", "variant"],
  ["Variant Price", "variant_price", "variant"],
  ["Variant Compare At Price", "variant_compare_at_price", "variant"],
  ["Variant Requires Shipping", "variant_requires_shipping", "variant"],
  ["Variant Taxable", "variant_taxable", "variant"],
  ["Variant Barcode", "variant_barcode", "variant"],
  ["Image Src", "image_src", "variant"],
  ["Image Position", "image_position", "variant"],
  ["Image Alt Text", "image_alt", "variant"],
  ["Gift Card", "gift_card", "product"],
  ["SEO Title", "seo_title", "product"],
  ["SEO Description", "seo_description", "product"],
  ["Variant Image", "variant_image", "variant"],
  ["Variant Weight Unit", "variant_weight_unit", "variant"],
  ["Variant Tax Code", "variant_tax_code", "variant"],
  ["Cost per item", "variant_cost", "variant"],
  ["Status", "status", "product"],
];

const CUSTOMER_MAP = [
  ["First Name", "first_name", "always"],
  ["Last Name", "last_name", "always"],
  ["Email", "email", "always"],
  ["Accepts Email Marketing", "accepts_marketing", "always"],
  ["Company", "company", "always"],
  ["Address1", "address1", "always"],
  ["Address2", "address2", "always"],
  ["City", "city", "always"],
  ["Province", "province", "always"],
  ["Province Code", "province_code", "always"],
  ["Country", "country", "always"],
  ["Country Code", "country_code", "always"],
  ["Zip", "zip", "always"],
  ["Phone", "phone", "always"],
  ["Total Spent", "total_spent", "always"],
  ["Total Orders", "orders_count", "always"],
  ["Note", "note", "always"],
  ["Tags", "tags", "always"],
];

const MAPS = { products: PRODUCT_MAP, customers: CUSTOMER_MAP };

/** Entities Shopify's own importer has a CSV layout for. */
export function hasShopifyLayout(entity) {
  return Object.hasOwn(MAPS, entity);
}

/**
 * @param {object[]} rows    - normalized rows (app dialect)
 * @param {string[]} [columns] - ignored for mapped entities (layout is fixed)
 * @param {string} entity
 * @returns {Buffer}
 */
export function toShopifyCSV(rows, columns, entity) {
  const map = MAPS[entity];
  if (!map) return toCSV(rows, columns);

  // Rows already carry Shopify's headers, so emit them directly rather than
  // running them back through the app's humanizer.
  const out = rows.map((row, i) => {
    // A record's first row carries the product-level values. Product exports
    // mark it with top_row; without that marker treat a changed handle as the
    // boundary, and fall back to "first row is top".
    const isTop = row.top_row
      ? String(row.top_row).toLowerCase() === "true"
      : i === 0 || row.handle !== rows[i - 1]?.handle;

    const obj = {};
    for (const [col, key, scope] of map) {
      const blank = scope === "product" && !isTop;
      obj[col] = blank ? "" : (row[key] ?? "");
    }
    return obj;
  });

  const headers = map.map(([col]) => col);
  return Buffer.from(csvText(out, headers), "utf8");
}

function csvText(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n") + "\n";
}
