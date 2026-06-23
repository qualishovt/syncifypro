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
  // Default to status:any (includes closed/cancelled/archived) unless the
  // user explicitly narrows the open/closed state.
  const clauses = [filters.status ? `status:${filters.status}` : "status:any"];

  if (filters.financialStatus)   clauses.push(`financial_status:${filters.financialStatus}`);
  if (filters.fulfillmentStatus) clauses.push(`fulfillment_status:${filters.fulfillmentStatus}`);
  if (filters.tag)               clauses.push(`tag:${quote(filters.tag)}`);
  if (filters.sourceName)        clauses.push(`source_name:${quote(filters.sourceName)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);
  if (filters.updatedAtMin) clauses.push(`updated_at:>=${filters.updatedAtMin}`);
  if (filters.updatedAtMax) clauses.push(`updated_at:<=${filters.updatedAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify customer search query string.
 *
 * Supported filters:
 *   email            — partial email match
 *   state            — "enabled" | "disabled" | "invited" | "declined"
 *   tag              — single customer tag
 *   country          — billing/default address country
 *   createdAtMin/Max — ISO date strings
 *   updatedAtMin/Max — ISO date strings
 */
export function buildCustomerQuery(filters = {}) {
  const clauses = [];

  if (filters.email)   clauses.push(`email:${quote(filters.email)}`);
  if (filters.state)   clauses.push(`state:${filters.state}`);
  if (filters.tag)     clauses.push(`tag:${quote(filters.tag)}`);
  if (filters.country) clauses.push(`country:${quote(filters.country)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);
  if (filters.updatedAtMin) clauses.push(`updated_at:>=${filters.updatedAtMin}`);
  if (filters.updatedAtMax) clauses.push(`updated_at:<=${filters.updatedAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify collection search query string.
 *
 * Supported filters:
 *   title             — partial title match
 *   collectionType    — "smart" | "custom"
 *   updatedAtMin/Max  — ISO date strings
 */
export function buildCollectionQuery(filters = {}) {
  const clauses = [];

  if (filters.title)          clauses.push(`title:${quote(filters.title)}`);
  if (filters.collectionType) clauses.push(`collection_type:${filters.collectionType}`);

  if (filters.updatedAtMin) clauses.push(`updated_at:>=${filters.updatedAtMin}`);
  if (filters.updatedAtMax) clauses.push(`updated_at:<=${filters.updatedAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify discount search query string.
 *
 * Supported filters:
 *   status — "active" | "expired" | "scheduled"
 *   title  — partial title match
 */
export function buildDiscountQuery(filters = {}) {
  const clauses = [];

  if (filters.status) clauses.push(`status:${filters.status}`);
  if (filters.title)  clauses.push(`title:${quote(filters.title)}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify search query for content entities (pages, blogs,
 * articles). All three share the same useful filter surface.
 *
 * Supported filters:
 *   title             — partial title match
 *   createdAtMin/Max  — ISO date strings
 *   updatedAtMin/Max  — ISO date strings
 */
export function buildContentQuery(filters = {}) {
  const clauses = [];

  if (filters.title) clauses.push(`title:${quote(filters.title)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);
  if (filters.updatedAtMin) clauses.push(`updated_at:>=${filters.updatedAtMin}`);
  if (filters.updatedAtMax) clauses.push(`updated_at:<=${filters.updatedAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify URL-redirect search query string.
 *
 * Supported filters:
 *   path   — partial old-path match
 *   target — partial target match
 */
export function buildRedirectQuery(filters = {}) {
  const clauses = [];

  if (filters.path)   clauses.push(`path:${quote(filters.path)}`);
  if (filters.target) clauses.push(`target:${quote(filters.target)}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify files search query string.
 *
 * Supported filters:
 *   mediaType — "IMAGE" | "VIDEO" | "GENERIC_FILE" | ...
 *   status    — "READY" | "PROCESSING" | "FAILED" | "UPLOADED"
 *   filename  — partial filename match
 *   createdAtMin/Max — ISO date strings
 */
export function buildFileQuery(filters = {}) {
  const clauses = [];

  if (filters.mediaType) clauses.push(`media_type:${filters.mediaType}`);
  if (filters.status)    clauses.push(`status:${filters.status}`);
  if (filters.filename)  clauses.push(`filename:${quote(filters.filename)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify draft-orders search query string.
 *
 * Supported filters:
 *   status           — "open" | "invoice_sent" | "completed"
 *   tag              — single tag
 *   createdAtMin/Max — ISO date strings
 */
export function buildDraftOrderQuery(filters = {}) {
  const clauses = [];

  if (filters.status) clauses.push(`status:${filters.status}`);
  if (filters.tag)    clauses.push(`tag:${quote(filters.tag)}`);

  if (filters.createdAtMin) clauses.push(`created_at:>=${filters.createdAtMin}`);
  if (filters.createdAtMax) clauses.push(`created_at:<=${filters.createdAtMax}`);

  return clauses.join(" ");
}

/**
 * Build a Shopify companies search query string.
 *
 * Supported filters:
 *   name             — partial company name match
 *   createdAtMin/Max — ISO date strings
 */
export function buildCompanyQuery(filters = {}) {
  const clauses = [];

  if (filters.name) clauses.push(`name:${quote(filters.name)}`);

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