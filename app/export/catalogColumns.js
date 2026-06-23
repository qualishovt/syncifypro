/**
 * export/catalogColumns.js
 *
 * Dynamic "Pricing by Catalogs" columns, matching Matrixify's format. Each
 * catalog (Markets / B2B) yields three columns (the key is the human header,
 * as elsewhere):
 *
 *   "Included / Wholesale"         — TRUE/FALSE: is the product in the catalog
 *   "Price / Wholesale"            — the variant's fixed price in that catalog
 *   "Compare At Price / Wholesale" — the variant's fixed compare-at price
 *
 * "Included" is product-level publication membership; the two prices are
 * per-variant, joined from each catalog's price list (the contextualPricing
 * context has no catalogId, so they aren't reachable in the product query).
 */

export function catalogIncludedKey(title) {
  return `Included / ${title}`;
}
export function catalogPriceKey(title) {
  return `Price / ${title}`;
}
export function catalogCompareKey(title) {
  return `Compare At Price / ${title}`;
}

/**
 * GraphQL alias for the i-th catalog's publishedOnPublication check, shared
 * by the products query (which aliases the field per catalog) and the
 * normalizer (which reads it back) so the two stay in lockstep by index.
 */
export function catalogPublishedAlias(i) {
  return `catpub_${i}`;
}

/** True if a column key belongs to the Pricing by Catalogs group. */
export function isCatalogColumn(key) {
  return (
    key.startsWith("Included / ") ||
    key.startsWith("Price / ") ||
    key.startsWith("Compare At Price / ")
  );
}

/**
 * Ordered column keys for a set of catalogs (Included, Price, Compare At
 * Price per catalog).
 * @param {{title:string}[]} catalogs
 * @returns {string[]}
 */
export function buildCatalogFieldKeys(catalogs = []) {
  const keys = [];
  for (const c of catalogs) {
    keys.push(catalogIncludedKey(c.title));
    keys.push(catalogPriceKey(c.title));
    keys.push(catalogCompareKey(c.title));
  }
  return keys;
}
