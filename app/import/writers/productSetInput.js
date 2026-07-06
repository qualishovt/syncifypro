/**
 * import/writers/productSetInput.js
 *
 * Pure transform: a product's assembled row group (the header-normalized,
 * snake_case rows that groupRecords() produced — one row per variant, first
 * row carrying the product-level fields) → the ProductSetInput + identifier
 * that the productSet mutation expects.
 *
 * Kept free of any network/admin dependency so it can be unit-tested against
 * the exact rows the export normalizer emits. This is the precise inverse of
 * export/normalizer.js buildProductRows().
 *
 * The ProductSetInput shape here is schema-validated against Admin API
 * 2026-07 (productSet). productSet treats list fields (variants, options,
 * metafields, files) as full-state: whatever we send becomes the product's
 * complete set. Because an import group contains ALL of a product's variant
 * rows, that lines up with a full round-trip.
 */

import { COMMAND, parseCommand } from "../command.js";
import { topRow } from "../assemble.js";

const STATUSES = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);

const WEIGHT_UNIT = {
  KILOGRAMS: "KILOGRAMS", KG: "KILOGRAMS",
  GRAMS: "GRAMS", G: "GRAMS",
  POUNDS: "POUNDS", LB: "POUNDS", LBS: "POUNDS",
  OUNCES: "OUNCES", OZ: "OUNCES",
};

const truthy = (v) => ["true", "1", "yes", "y", "x"].includes(String(v ?? "").trim().toLowerCase());
const clean = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : s;
};
const num = (v) => {
  const s = clean(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
};

/** "gid://shopify/Product/123" from a bare "123" (or pass a gid through). */
function toGid(type, id) {
  const s = clean(id);
  if (s === undefined) return undefined;
  return s.startsWith("gid://") ? s : `gid://shopify/${type}/${s}`;
}

function toWeightUnit(u) {
  const s = clean(u);
  if (s === undefined) return undefined;
  return WEIGHT_UNIT[s.toUpperCase()];
}

/** Parse a dynamic metafield column key back into a metafield input. */
export function parseMetafieldColumn(header, value) {
  // "Metafield: custom.care [single_line_text_field]"
  const m = /^(?:Variant )?Metafield:\s*([^.]+)\.(.+?)\s*\[(.+)\]$/.exec(header);
  const val = clean(value);
  if (!m || val === undefined) return null;
  return { namespace: m[1].trim(), key: m[2].trim(), type: m[3].trim(), value: val };
}

function metafieldsFrom(row, { variant }) {
  const prefix = variant ? "Variant Metafield:" : "Metafield:";
  const out = [];
  for (const [header, value] of Object.entries(row)) {
    // Product metafields must not swallow "Variant Metafield:" columns.
    if (variant ? !header.startsWith(prefix) : (!header.startsWith(prefix) || header.startsWith("Variant "))) continue;
    const mf = parseMetafieldColumn(header, value);
    if (mf) out.push(mf);
  }
  return out.length ? out : undefined;
}

/** True if a row carries actual variant data (vs. an image-only spill row). */
export function isVariantRow(row) {
  return Boolean(clean(row.variant_id) || clean(row.sku) || clean(row.price) ||
    clean(row.option1_value) || clean(row.barcode));
}

function buildVariant(row) {
  const optionValues = [];
  for (let i = 1; i <= 3; i++) {
    const name = clean(row[`option${i}_name`]);
    const value = clean(row[`option${i}_value`]);
    if (name && value) optionValues.push({ optionName: name, name: value });
  }

  const inventoryItem = {};
  const cost = clean(row.variant_cost);
  if (cost !== undefined) inventoryItem.cost = cost;
  if (clean(row.inventory_tracker) !== undefined) inventoryItem.tracked = true;
  if (clean(row.requires_shipping) !== undefined) inventoryItem.requiresShipping = truthy(row.requires_shipping);
  const wv = num(row.weight);
  const wu = toWeightUnit(row.weight_unit);
  if (wv !== undefined && wu) inventoryItem.measurement = { weight: { value: wv, unit: wu } };
  if (clean(row.variant_hs_code)) inventoryItem.harmonizedSystemCode = clean(row.variant_hs_code);
  if (clean(row.variant_country_of_origin)) inventoryItem.countryCodeOfOrigin = clean(row.variant_country_of_origin);
  if (clean(row.variant_province_of_origin)) inventoryItem.provinceCodeOfOrigin = clean(row.variant_province_of_origin);

  const v = {};
  if (optionValues.length) v.optionValues = optionValues;
  if (clean(row.variant_id)) v.id = toGid("ProductVariant", row.variant_id);
  if (clean(row.price) !== undefined) v.price = clean(row.price);
  if (clean(row.compare_at_price) !== undefined) v.compareAtPrice = clean(row.compare_at_price);
  if (clean(row.sku) !== undefined) v.sku = clean(row.sku);
  if (clean(row.barcode) !== undefined) v.barcode = clean(row.barcode);
  if (clean(row.taxable) !== undefined) v.taxable = truthy(row.taxable);
  if (clean(row.inventory_policy)) v.inventoryPolicy = clean(row.inventory_policy).toUpperCase();
  if (Object.keys(inventoryItem).length) v.inventoryItem = inventoryItem;
  const mf = metafieldsFrom(row, { variant: true });
  if (mf) v.metafields = mf;
  return v;
}

function buildOptions(rows) {
  const options = [];
  const top = topRow(rows);
  for (let i = 1; i <= 3; i++) {
    const name = clean(top[`option${i}_name`]);
    if (!name) continue;
    const values = [];
    const seen = new Set();
    for (const row of rows) {
      const value = clean(row[`option${i}_value`]);
      if (value && !seen.has(value)) { seen.add(value); values.push({ name: value }); }
    }
    if (values.length) options.push({ name, values });
  }
  return options;
}

function buildFiles(rows) {
  const files = [];
  const seen = new Set();
  for (const row of rows) {
    const url = clean(row.image_url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const file = { originalSource: url, contentType: "IMAGE" };
    if (clean(row.image_alt)) file.alt = clean(row.image_alt);
    files.push(file);
  }
  return files;
}

/**
 * Build { command, identifier, input } for a product group.
 * `command` is the parsed COMMAND from the top row; the writer decides how to
 * dispatch it. `identifier`/`input` are ready for the productSet mutation
 * (identifier is undefined for NEW / when no id/handle is available).
 *
 * @param {object[]} group - assembled rows for one product
 * @returns {{ command: string, identifier: object|undefined, input: object }}
 */
export function buildProductSetInput(group) {
  const top = topRow(group);
  const command = parseCommand(top.command);

  const input = {};
  if (clean(top.title) !== undefined) input.title = clean(top.title);
  if (clean(top.handle) !== undefined) input.handle = clean(top.handle);
  const desc = clean(top.body_html) ?? clean(top.description);
  if (desc !== undefined) input.descriptionHtml = desc;
  if (clean(top.vendor) !== undefined) input.vendor = clean(top.vendor);
  if (clean(top.product_type) !== undefined) input.productType = clean(top.product_type);
  if (clean(top.template_suffix) !== undefined) input.templateSuffix = clean(top.template_suffix);
  if (clean(top.gift_card) !== undefined) input.giftCard = truthy(top.gift_card);
  if (clean(top.status)) {
    const s = clean(top.status).toUpperCase();
    if (STATUSES.has(s)) input.status = s;
  }
  if (clean(top.tags) !== undefined) {
    input.tags = clean(top.tags) ? clean(top.tags).split(",").map((t) => t.trim()).filter(Boolean) : [];
  }
  if (clean(top.seo_title) || clean(top.seo_description)) {
    input.seo = {};
    if (clean(top.seo_title)) input.seo.title = clean(top.seo_title);
    if (clean(top.seo_description)) input.seo.description = clean(top.seo_description);
  }
  if (clean(top.category_id)) input.category = toGid("TaxonomyCategory", top.category_id);

  const options = buildOptions(group);
  if (options.length) input.productOptions = options;

  const variants = group.filter(isVariantRow).map(buildVariant).filter((v) => Object.keys(v).length);
  if (variants.length) input.variants = variants;

  const productMetafields = metafieldsFrom(top, { variant: false });
  if (productMetafields) input.metafields = productMetafields;

  const files = buildFiles(group);
  if (files.length) input.files = files;

  // identifier: prefer id, else handle. NEW always creates (no identifier).
  // The id goes in `identifier` ONLY — productSet rejects the id in `input` when
  // an identifier is provided ("The id field is not allowed if identifier is
  // provided.", ID_NOT_ALLOWED).
  let identifier;
  if (command !== COMMAND.NEW) {
    if (clean(top.product_id)) identifier = { id: toGid("Product", top.product_id) };
    else if (clean(top.handle)) identifier = { handle: clean(top.handle) };
  }

  return { command, identifier, input };
}
