/**
 * export/metafieldColumns.js
 *
 * Dynamic Metafields / Variant Metafields columns. Like the inventory
 * group, the columns depend on the store (its metafield definitions), and
 * the column KEY is the human header itself so it doubles as the export
 * header and round-trips like Matrixify's metafield columns:
 *
 *   "Metafield: custom.care_guide [single_line_text_field]"
 *   "Variant Metafield: custom.gtin [single_line_text_field]"
 *
 * The UI builds the column list from metafield definitions; the normalizer
 * fills values from each product's / variant's metafields. Both use the same
 * key shape, so a defined metafield lines up with its column.
 */

export const PRODUCT_MF_PREFIX = "Metafield";
export const VARIANT_MF_PREFIX = "Variant Metafield";

/** "Metafield" + custom + care_guide + single_line_text_field → "Metafield: custom.care_guide [single_line_text_field]" */
export function metafieldColumnKey(prefix, namespace, key, type) {
  return `${prefix}: ${namespace}.${key} [${type}]`;
}

/**
 * Build column keys from metafield definitions.
 * @param {{namespace:string, key:string, type:({name:string}|string)}[]} defs
 * @param {string} prefix - PRODUCT_MF_PREFIX | VARIANT_MF_PREFIX
 * @returns {string[]}
 */
export function buildMetafieldFieldKeys(defs = [], prefix) {
  return defs.map((d) =>
    metafieldColumnKey(prefix, d.namespace, d.key, d.type?.name ?? d.type ?? ""),
  );
}

/**
 * Flatten a node's metafields into { columnKey: value } entries to merge
 * into the row. Used for both product and variant metafields.
 * @param {{namespace:string, key:string, type:string, value:string}[]} [metafields]
 * @param {string} prefix
 */
export function metafieldRowEntries(metafields, prefix) {
  const out = {};
  for (const mf of metafields ?? []) {
    if (!mf?.namespace || !mf?.key) continue;
    out[metafieldColumnKey(prefix, mf.namespace, mf.key, mf.type ?? "")] = mf.value ?? "";
  }
  return out;
}
