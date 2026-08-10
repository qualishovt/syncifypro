/**
 * export/formats/googleFeed.js
 *
 * Google Shopping product feed — RSS 2.0 with the g: namespace, the format
 * Google Merchant Center ingests directly. One <item> per variant row.
 *
 * Only products have a feed layout; any other entity falls back to the
 * app's generic XML dialect so a multi-entity export never loses a sheet.
 *
 * Google requires a currency on prices and absolute product links, neither
 * of which lives on the rows — the caller passes them via `ctx`
 * ({ shopName, currency, domain }), fetched once per export run.
 */

import { Buffer } from "node:buffer";
import { toXML } from "./xml.js";

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * body_html → plain text description (Google caps at 5000 chars). Decodes
 * the common entities so esc() doesn't double-escape "&amp;" into
 * "&amp;amp;" on the way back out.
 */
function stripHtml(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);
}

/** "12.5 USD" — Google's price format; empty when either part is missing. */
function money(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n) || amount === "" || amount == null || !currency) return "";
  return `${n.toFixed(2)} ${currency}`;
}

/** Variant title: "Snowboard - Blue / Large" (skips Default Title). */
function itemTitle(row) {
  const opts = [row.option1_value, row.option2_value, row.option3_value]
    .filter((v) => v && v !== "Default Title");
  return opts.length ? `${row.title} - ${opts.join(" / ")}` : (row.title ?? "");
}

function itemLink(row, ctx) {
  const base = row.url
    || (ctx.domain && row.handle ? `https://${ctx.domain}/products/${row.handle}` : "");
  if (!base) return "";
  return row.variant_id ? `${base}?variant=${row.variant_id}` : base;
}

function availability(row) {
  const qty = Number(row.inventory_qty);
  if (Number.isFinite(qty) && qty > 0) return "in stock";
  // Selling with no tracking, or "continue when out of stock", still sells.
  const policy = String(row.inventory_policy ?? "").toLowerCase();
  if (policy === "continue" || row.inventory_qty === "") return "in stock";
  return "out of stock";
}

/** The g: fields for one variant row, in Google's documented order. */
function itemFields(row, ctx) {
  const price = Number(row.price);
  const compareAt = Number(row.compare_at_price);
  // Shopify's price IS the sale price when compare-at is higher — Google
  // wants the original as g:price and the discount as g:sale_price.
  const onSale = Number.isFinite(compareAt) && compareAt > price;
  return {
    "g:id": row.sku || row.variant_id || row.product_id,
    "g:item_group_id": row.product_id,
    "g:title": itemTitle(row),
    "g:description": stripHtml(row.body_html),
    "g:link": itemLink(row, ctx),
    "g:image_link": row.variant_image || row.image_url || "",
    "g:availability": availability(row),
    "g:price": money(onSale ? row.compare_at_price : row.price, ctx.currency),
    "g:sale_price": onSale ? money(row.price, ctx.currency) : "",
    "g:brand": row.vendor ?? "",
    "g:gtin": row.barcode ?? "",
    "g:mpn": row.gs_mpn || row.sku || "",
    "g:condition": row.gs_condition || "new",
    "g:google_product_category": row.gs_google_product_category || "",
    "g:product_type": row.product_type ?? "",
    "g:age_group": row.gs_age_group || "",
    "g:gender": row.gs_gender || "",
    "g:color": row.gs_color || "",
    "g:material": row.gs_material || "",
    "g:size": row.gs_size || "",
    "g:size_system": row.gs_size_system || "",
    "g:custom_label_0": row.gs_custom_product || "",
  };
}

/**
 * Serialize product rows to a Google Merchant Center RSS feed Buffer.
 *
 * @param {object[]} rows      - normalized rows
 * @param {string[]} [columns] - ignored: the feed has a fixed field set
 * @param {string}   [entity]  - non-product entities fall back to plain XML
 * @param {object}   [ctx]     - { shopName, currency, domain }
 * @returns {Buffer}
 */
export function toGoogleFeed(rows, columns, entity = "products", ctx = {}) {
  if (entity !== "products") return toXML(rows, columns);

  // Feed items are variants; skip supplementary rows (extra images etc.).
  const variants = rows.filter((r) => r.variant_id || r.sku || r.price !== "");

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>${esc(ctx.shopName ?? "Product feed")}</title>`,
    `    <link>${esc(ctx.domain ? `https://${ctx.domain}` : "")}</link>`,
    "    <description>Google Shopping product feed</description>",
  ];

  for (const row of variants) {
    lines.push("    <item>");
    for (const [tag, value] of Object.entries(itemFields(row, ctx))) {
      if (value !== "" && value != null) lines.push(`      <${tag}>${esc(value)}</${tag}>`);
    }
    lines.push("    </item>");
  }

  lines.push("  </channel>", "</rss>", "");
  return Buffer.from(lines.join("\n"), "utf8");
}
