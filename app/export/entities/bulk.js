/**
 * export/entities/bulk.js
 *
 * Generic Shopify Bulk Operations support for large stores. Shopify runs
 * the query on their infrastructure and notifies us via webhook when the
 * JSONL result is ready (see workers/bulkOperationWorker.js).
 *
 * Per entity we define:
 *   - a bulk query builder (the GraphQL the bulk op runs)
 *   - a count query (to decide direct vs bulk in exportJob.js)
 *   - a reconcile strategy the worker uses to turn JSONL nodes into rows
 *
 * Bulk-operation rules we follow here:
 *   - connections use `edges { node { … } }`
 *   - no `first`/`last`/`after` args on connection fields
 *
 * "flat" entities emit one JSONL node per record (no child lines).
 * "parentChild" entities (products) emit child nodes carrying __parentId.
 *
 * Docs: https://shopify.dev/docs/api/usage/bulk-operations/queries
 */

import {
  normalizeProduct,
  normalizeCustomer,
  normalizeCollection,
  normalizePage,
  normalizeBlog,
} from "../normalizer.js";

const BULK_OPERATION_RUN = `#graphql
  mutation BulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const CURRENT_BULK_OPERATION = `#graphql
  query CurrentBulkOperation {
    currentBulkOperation { id status }
  }
`;

// ─── per-entity bulk query builders ───────────────────────────────────────────

/** Embed an optional Shopify search filter as `(query: "…")`. */
function queryArg(filterQuery) {
  return filterQuery ? `(query: "${filterQuery.replace(/"/g, '\\"')}")` : "";
}

// NOTE: kept verbatim from the original products-only bulk path to
// preserve its exact behavior and the worker's variant grouping.
function buildProductsBulkQuery(filterQuery = "") {
  return `
    {
      products${queryArg(filterQuery)} {
        id title handle status descriptionHtml vendor productType tags
        createdAt updatedAt
        images(first: 1) { url }
        variants {
          id title sku price compareAtPrice inventoryQuantity barcode taxable
          inventoryItem { measurement { weight { value unit } } }
        }
      }
    }
  `;
}

function buildCustomersBulkQuery(filterQuery = "") {
  return `
    {
      customers${queryArg(filterQuery)} {
        edges { node {
          id firstName lastName note tags verifiedEmail state createdAt updatedAt
          numberOfOrders
          amountSpent { amount currencyCode }
          defaultEmailAddress { emailAddress marketingState marketingOptInLevel }
          defaultPhoneNumber { phoneNumber }
          defaultAddress {
            address1 address2 city province provinceCode zip country countryCodeV2 company phone
          }
        } }
      }
    }
  `;
}

function buildCollectionsBulkQuery(filterQuery = "") {
  return `
    {
      collections${queryArg(filterQuery)} {
        edges { node {
          id title handle descriptionHtml sortOrder templateSuffix updatedAt
          productsCount { count }
          image { url }
          seo { title description }
          ruleSet { appliedDisjunctively rules { column relation condition } }
        } }
      }
    }
  `;
}

function buildPagesBulkQuery(filterQuery = "") {
  return `
    {
      pages${queryArg(filterQuery)} {
        edges { node {
          id title handle body bodySummary isPublished publishedAt
          templateSuffix createdAt updatedAt
        } }
      }
    }
  `;
}

function buildBlogsBulkQuery(filterQuery = "") {
  return `
    {
      blogs${queryArg(filterQuery)} {
        edges { node {
          id title handle templateSuffix commentPolicy createdAt updatedAt
        } }
      }
    }
  `;
}

const BULK_QUERY_BUILDERS = {
  products:    buildProductsBulkQuery,
  customers:   buildCustomersBulkQuery,
  collections: buildCollectionsBulkQuery,
  pages:       buildPagesBulkQuery,
  blogs:       buildBlogsBulkQuery,
};

// ─── per-entity count queries ─────────────────────────────────────────────────
// field name on QueryRoot → returns { count }. Used to choose direct vs bulk.
const COUNT_FIELDS = {
  products:    "productsCount",
  customers:   "customersCount",
  collections: "collectionsCount",
  pages:       "pagesCount",
  blogs:       "blogsCount",
};

// ─── per-entity reconcile config (used by the worker) ─────────────────────────
export const BULK_RECONCILE = {
  products:    { strategy: "parentChild", normalize: normalizeProduct },
  customers:   { strategy: "flat",        normalize: normalizeCustomer },
  collections: { strategy: "flat",        normalize: normalizeCollection },
  pages:       { strategy: "flat",        normalize: normalizePage },
  blogs:       { strategy: "flat",        normalize: normalizeBlog },
};

/** Entities for which bulk operations are supported. */
export const BULK_ENTITIES = Object.keys(BULK_QUERY_BUILDERS);

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Get the store's count for an entity (used to decide direct vs bulk).
 * @returns {Promise<number>}
 */
export async function getEntityCount(admin, entity) {
  const field = COUNT_FIELDS[entity];
  if (!field) return 0;

  const res = await admin.graphql(`#graphql
    query EntityCount { ${field} { count } }
  `);
  const { data } = await res.json();
  return data?.[field]?.count ?? 0;
}

/**
 * Submit a bulk operation for an entity, with an optional row filter.
 * Throws if another bulk operation is already running (Shopify allows
 * only one at a time per shop).
 *
 * @returns {Promise<{ bulkOperationId: string }>}
 */
export async function submitBulkOperation(admin, { entity, query = "" }) {
  const builder = BULK_QUERY_BUILDERS[entity];
  if (!builder) throw new Error(`Bulk export not supported for entity: ${entity}`);

  const currentRes = await admin.graphql(CURRENT_BULK_OPERATION);
  const { data: currentData } = await currentRes.json();
  const current = currentData?.currentBulkOperation;

  if (current && ["CREATED", "RUNNING"].includes(current.status)) {
    throw new Error(
      `A bulk operation is already running (ID: ${current.id}, status: ${current.status}). ` +
      `Please wait for it to complete before starting a new export.`
    );
  }

  const res = await admin.graphql(BULK_OPERATION_RUN, {
    variables: { query: builder(query) },
  });

  const { data } = await res.json();
  const { bulkOperation, userErrors } = data?.bulkOperationRunQuery ?? {};

  if (userErrors?.length) {
    throw new Error(`Bulk operation error: ${userErrors.map((e) => e.message).join(", ")}`);
  }

  return { bulkOperationId: bulkOperation.id };
}
