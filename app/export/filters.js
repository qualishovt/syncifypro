/**
 * export/filters.js
 *
 * Converts a structured filter object into Shopify's search query
 * syntax string used by the `query` argument on GraphQL connections.
 *
 * Shopify search syntax reference:
 * https://shopify.dev/docs/api/usage/search-syntax
 *
 * Example:
 *   buildProductQuery({ status: "active", vendor: "Nike", tag: "sale" })
 *   → "status:active vendor:Nike tag:sale"
 *
 *   buildProductQuery({ createdAtMin: "2026-01-01", createdAtMax: "2026-03-01" })
 *   → "created_at:>=2026-01-01 created_at:<=2026-03-01"
 */

/**
 * Build a Shopify product search query string from a filter object.
 * All provided filters are AND-ed together.
 *
 * Supported filters:
 *   status       — "active" | "draft" | "archived"
 *   vendor       — exact vendor name
 *   productType  — exact product type
 *   tag          — single tag the product must have
 *   title        — partial title match
 *   createdAtMin — ISO date string (inclusive lower bound)
 *   createdAtMax — ISO date string (inclusive upper bound)
 *   updatedAtMin — ISO date string
 *   updatedAtMax — ISO date string
 *
 * @param {object} [filters]
 * @returns {string} Shopify query string (empty string if no filters)
 */
export function buildProductQuery(filters = {}) {
  const clauses = [];

  if (filters.status)      clauses.push(`status:${filters.status}`);
  if (filters.vendor)      clauses.push(`vendor:${quote(filters.vendor)}`);
  if (filters.productType) clauses.push(`product_type:${quote(filters.productType)}`);
  if (filters.tag)         clauses.push(`tag:${quote(filters.tag)}`);
  if (filters.title)       clauses.push(`title:${quote(filters.title)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);
  if (filters.updatedAtMin) clauses.push(`updated_at:>=${filters.updatedAtMin}`);
  if (filters.updatedAtMax) clauses.push(`updated_at:<=${filters.updatedAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify order search query string from a filter object.
 * Always includes "status:any" so closed/cancelled orders are returned.
 *
 * Supported filters:
 *   financialStatus    — "paid" | "pending" | "refunded" | ...
 *   fulfillmentStatus  — "fulfilled" | "unfulfilled" | "partial"
 *   createdAtMin/Max   — ISO date strings
 *   tag                — single order tag
 *
 * @param {object} [filters]
 * @returns {string}
 */
export function buildOrderQuery(filters = {}) {
  const clauses = ["status:any"];

  if (filters.financialStatus)   clauses.push(`financial_status:${filters.financialStatus}`);
  if (filters.fulfillmentStatus) clauses.push(`fulfillment_status:${filters.fulfillmentStatus}`);
  if (filters.tag)               clauses.push(`tag:${quote(filters.tag)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);

  return clauses.join(" ");
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Wrap a value in single quotes if it contains spaces, so multi-word
 * values like "Acme Corp" are treated as a single search term.
 */
function quote(value) {
  const str = String(value);
  return /\s/.test(str) ? `'${str}'` : str;
}