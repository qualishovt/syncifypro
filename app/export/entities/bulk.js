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
  buildProductRows,
  buildOrderRows,
  normalizeCustomer,
  normalizeCollection,
  normalizeDiscount,
  normalizePage,
  normalizeBlog,
  normalizeArticle,
  normalizeRedirect,
  normalizeFile,
  buildCompanyRows,
  normalizeDraftOrder,
} from "../normalizer.js";
import { INVENTORY_QUANTITY_NAMES } from "../inventoryColumns.js";

// Per-location inventory levels for the bulk products query — a connection,
// so bulk emits InventoryLevel child lines (__parentId = inventoryItem id).
// Included only when a Multi-Location Inventory column is selected, so normal
// large-store exports are unaffected.
const INVENTORY_LEVELS_BULK_FRAGMENT = `
              inventoryLevels { edges { node {
                id
                location { name }
                quantities(names: [${INVENTORY_QUANTITY_NAMES.map((n) => `"${n}"`).join(", ")}]) { name quantity }
              } } }`;

// Metafields are connections in bulk → child lines (__parentId = product or
// variant id). Included only when a metafield column is selected.
const PRODUCT_METAFIELDS_BULK_FRAGMENT = `
          metafields { edges { node { id namespace key value type } } }`;
const VARIANT_METAFIELDS_BULK_FRAGMENT = `
            metafields { edges { node { id namespace key value type } } }`;

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

// Mirrors the direct-path query in entities/products.js so bulk exports
// carry the same columns. Bulk rules: connections use `edges { node }`,
// no `first`/`after` args, and every node selects `id` so the worker can
// rebuild parent→child relationships from the flat JSONL via __parentId.
// `category`, `selectedOptions`, `ruleSet`, `inventoryItem` are non-
// connection fields, so they stay inline on their node.
function buildProductsBulkQuery(filterQuery = "", { includeInventory, includeMetafields, includeVariantMetafields } = {}) {
  return `
    {
      products${queryArg(filterQuery)} {
        edges { node {
          id title handle status descriptionHtml vendor productType tags
          createdAt updatedAt publishedAt templateSuffix isGiftCard onlineStoreUrl totalInventory
          seo { title description }
          category { id name fullName }${includeMetafields ? PRODUCT_METAFIELDS_BULK_FRAGMENT : ""}
          collections { edges { node { id title ruleSet { appliedDisjunctively } } } }
          media { edges { node { id ... on MediaImage { mimeType image { url altText width height } } } } }
          variants { edges { node {
            id title sku price compareAtPrice inventoryQuantity barcode taxable
            position inventoryPolicy
            selectedOptions { name value }
            deliveryProfile { name }${includeVariantMetafields ? VARIANT_METAFIELDS_BULK_FRAGMENT : ""}
            media { edges { node { id ... on MediaImage { image { url } } } } }
            inventoryItem {
              id tracked requiresShipping
              unitCost { amount }
              countryCodeOfOrigin provinceCodeOfOrigin harmonizedSystemCode
              measurement { weight { value unit } }${includeInventory ? INVENTORY_LEVELS_BULK_FRAGMENT : ""}
            }
          } } }
        } }
      }
    }
  `;
}

// Mirrors the direct-path orders query (entities/orders.js). lineItems is the
// only connection, so bulk emits LineItem child lines (__parentId = order id);
// the worker calls normalizeOrder(order, lineItem) per child via parentChild.
function buildOrdersBulkQuery(filterQuery = "") {
  return `
    {
      orders${queryArg(filterQuery)} {
        edges { node {
          id name note tags email phone
          createdAt updatedAt processedAt cancelledAt closedAt cancelReason
          displayFinancialStatus displayFulfillmentStatus currencyCode presentmentCurrencyCode
          taxesIncluded test confirmed sourceName statusPageUrl currentSubtotalLineItemsQuantity totalWeight
          clientIp sourceIdentifier confirmationNumber
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          currentTotalPriceSet { shopMoney { amount } }
          totalRefundedSet { shopMoney { amount } }
          currentTotalDutiesSet { shopMoney { amount } }
          originalTotalDutiesSet { shopMoney { amount } }
          currentTotalAdditionalFeesSet { shopMoney { amount } }
          originalTotalAdditionalFeesSet { shopMoney { amount } }
          totalReceivedSet { shopMoney { amount } }
          netPaymentSet { shopMoney { amount } }
          totalCapturableSet { shopMoney { amount } }
          taxLines { title rate ratePercentage channelLiable priceSet { shopMoney { amount } } }
          customerJourneySummary { lastVisit { landingPage referrerUrl source sourceType utmParameters { source medium campaign term content } } }
          purchasingEntity { __typename ... on PurchasingCompany { company { id name } location { id name } } }
          shippingLine { title code source originalPriceSet { shopMoney { amount } } taxLines { title rate priceSet { shopMoney { amount } } } }
          billingAddress { firstName lastName name company phone address1 address2 city province provinceCode zip country countryCodeV2 }
          shippingAddress { firstName lastName name company phone address1 address2 city province provinceCode zip country countryCodeV2 }
          customer {
            id firstName lastName note state numberOfOrders taxExempt tags
            defaultEmailAddress { emailAddress marketingState }
            defaultPhoneNumber { phoneNumber marketingState }
            amountSpent { amount currencyCode }
          }
          lineItems { edges { node {
            id title name variantTitle sku vendor quantity currentQuantity unfulfilledQuantity
            requiresShipping taxable isGiftCard fulfillmentStatus
            originalUnitPriceSet { shopMoney { amount } }
            discountedUnitPriceSet { shopMoney { amount } }
            discountedTotalSet { shopMoney { amount } }
            totalDiscountSet { shopMoney { amount } }
            taxLines { title rate ratePercentage channelLiable priceSet { shopMoney { amount } } }
            customAttributes { key value }
            variant {
              id sku barcode inventoryQuantity price compareAtPrice
              inventoryItem { unitCost { amount } measurement { weight { value unit } } countryCodeOfOrigin harmonizedSystemCode provinceCodeOfOrigin }
            }
            product { id handle productType tags }
          } } }
        } }
      }
    }
  `;
}

// Mirrors the direct-path discounts query (entities/discounts.js). codes is a
// connection, so bulk emits DiscountRedeemCode child lines (__parentId = node
// id); buildDiscountBulkRows rebuilds discount.codes before normalizing.
function buildDiscountsBulkQuery(filterQuery = "") {
  return `
    {
      discountNodes${queryArg(filterQuery)} {
        edges { node {
          id
          discount {
            __typename
            ... on DiscountCodeBasic { title summary status createdAt updatedAt startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } minimumRequirement { __typename ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } } } codes { edges { node { id code } } } customerGets { value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } } }
            ... on DiscountAutomaticBasic { title summary status createdAt updatedAt startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } minimumRequirement { __typename ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } } } customerGets { value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } } }
            ... on DiscountCodeFreeShipping { title summary status createdAt updatedAt startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes { edges { node { id code } } } }
            ... on DiscountAutomaticFreeShipping { title summary status createdAt updatedAt startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
            ... on DiscountCodeBxgy { title summary status createdAt updatedAt startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } codes { edges { node { id code } } } }
            ... on DiscountAutomaticBxgy { title summary status createdAt updatedAt startsAt endsAt asyncUsageCount combinesWith { orderDiscounts productDiscounts shippingDiscounts } }
          }
        } }
      }
    }
  `;
}

// Mirrors the direct-path articles query (entities/articles.js). All fields are
// flat objects, so it's a "flat" reconcile — one JSONL node per article.
function buildRedirectsBulkQuery(filterQuery = "") {
  return `
    {
      urlRedirects${queryArg(filterQuery)} {
        edges { node { id path target } }
      }
    }
  `;
}

// Mirrors the direct companies query. locations is the only connection, so
// bulk emits CompanyLocation child lines (__parentId = company id); the worker
// rebuilds company.locations via buildCompanyBulkRows before flattening.
function buildCompaniesBulkQuery(filterQuery = "") {
  return `
    {
      companies${queryArg(filterQuery)} {
        edges { node {
          id name externalId note createdAt updatedAt
          contactsCount { count }
          ordersCount { count }
          totalSpent { amount currencyCode }
          mainContact { id customer { id displayName defaultEmailAddress { emailAddress } } }
          locations {
            edges { node {
              id name externalId phone note
              billingAddress { address1 address2 city province zip country countryCode phone recipient }
              shippingAddress { address1 address2 city province zip country countryCode phone recipient }
            } }
          }
        } }
      }
    }
  `;
}

// Mirrors the direct draft-orders query. lineItems is the only connection, so
// bulk emits DraftOrderLineItem child lines; normalizeDraftOrder runs per child.
function buildDraftOrdersBulkQuery(filterQuery = "") {
  return `
    {
      draftOrders${queryArg(filterQuery)} {
        edges { node {
          id name status email phone note2 tags createdAt updatedAt completedAt invoiceUrl
          currencyCode taxExempt taxesIncluded
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount } }
          totalTaxSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          shippingLine { title originalPriceSet { shopMoney { amount } } }
          customer { id firstName lastName defaultEmailAddress { emailAddress } }
          billingAddress { firstName lastName name company phone address1 address2 city province provinceCode zip country countryCodeV2 }
          shippingAddress { firstName lastName name company phone address1 address2 city province provinceCode zip country countryCodeV2 }
          lineItems {
            edges { node {
              id title name variantTitle sku vendor quantity requiresShipping taxable isGiftCard
              originalUnitPriceSet { shopMoney { amount } }
              approximateDiscountedUnitPriceSet { shopMoney { amount } }
              customAttributes { key value }
              product { id handle }
              variant { id }
            } }
          }
        } }
      }
    }
  `;
}

function buildFilesBulkQuery(filterQuery = "") {
  return `
    {
      files${queryArg(filterQuery)} {
        edges { node {
          __typename id alt fileStatus createdAt updatedAt
          ... on MediaImage { mimeType originalSource { fileSize } image { url width height } }
          ... on GenericFile { mimeType originalFileSize url }
          ... on Video { duration originalSource { url fileSize width height mimeType } }
        } }
      }
    }
  `;
}

function buildArticlesBulkQuery(filterQuery = "") {
  return `
    {
      articles${queryArg(filterQuery)} {
        edges { node {
          id title handle body summary isPublished publishedAt templateSuffix tags createdAt updatedAt
          author { name }
          blog { id title handle }
          image { url altText }
        } }
      }
    }
  `;
}

// Mirrors the direct customers query, minus the first:1 sub-connections
// (firstOrder/lastOrder/storeCreditAccounts) — bulk operations disallow
// first/last/after args, so those columns are blank in bulk mode (≥10k).
function buildCustomersBulkQuery(filterQuery = "") {
  return `
    {
      customers${queryArg(filterQuery)} {
        edges { node {
          id firstName lastName note tags locale taxExempt verifiedEmail state createdAt updatedAt
          numberOfOrders multipassIdentifier
          amountSpent { amount currencyCode }
          defaultEmailAddress { emailAddress marketingState marketingOptInLevel marketingUpdatedAt }
          defaultPhoneNumber { phoneNumber marketingState marketingOptInLevel marketingUpdatedAt marketingCollectedFrom }
          defaultAddress {
            id firstName lastName company phone
            address1 address2 city province provinceCode zip country countryCodeV2
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
          image { url altText width height }
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
  orders:      buildOrdersBulkQuery,
  customers:   buildCustomersBulkQuery,
  collections: buildCollectionsBulkQuery,
  smart_collections:  buildCollectionsBulkQuery,
  custom_collections: buildCollectionsBulkQuery,
  discounts:   buildDiscountsBulkQuery,
  pages:       buildPagesBulkQuery,
  blogs:       buildBlogsBulkQuery,
  articles:    buildArticlesBulkQuery,
  redirects:   buildRedirectsBulkQuery,
  files:       buildFilesBulkQuery,
  companies:   buildCompaniesBulkQuery,
  draft_orders: buildDraftOrdersBulkQuery,
};

// ─── per-entity count queries ─────────────────────────────────────────────────
// field name on QueryRoot → returns { count }. Used to choose direct vs bulk.
const COUNT_FIELDS = {
  products:    "productsCount",
  orders:      "ordersCount",
  customers:   "customersCount",
  collections: "collectionsCount",
  smart_collections:  "collectionsCount",
  custom_collections: "collectionsCount",
  discounts:   "discountNodesCount",
  pages:       "pagesCount",
  blogs:       "blogsCount",
  redirects:   "urlRedirectsCount",
  companies:   "companiesCount",
  draft_orders: "draftOrdersCount",
  // articles: no count query exists in the Admin API — handled in getEntityCount.
};

// ─── per-entity reconcile config (used by the worker) ─────────────────────────
// "parentChild" entities provide `buildRows(parent, children, startRow)`,
// which returns every export row for one parent (products fan out to one
// row per variant/image). "flat" entities provide `normalize(node)`.
export const BULK_RECONCILE = {
  products: {
    strategy: "parentChild",
    buildRows: (parent, children, startRow, options) =>
      buildProductRows(assembleProduct(parent, children), startRow, options),
  },
  // Orders: lineItems stream as child lines; buildOrderRows emits Line Item
  // rows (transactions/refunds/fulfillments aren't in the bulk query, so those
  // row types only appear on the direct path).
  orders: {
    strategy: "parentChild",
    buildRows: (parent, children) => buildOrderRows({ ...parent, lineItems: { nodes: children } }),
  },
  customers:   { strategy: "flat", normalize: normalizeCustomer },
  collections: { strategy: "flat", normalize: normalizeCollection },
  smart_collections:  { strategy: "flat", normalize: normalizeCollection },
  custom_collections: { strategy: "flat", normalize: normalizeCollection },
  // Discounts: codes stream as child lines; rebuild discount.codes, one row each.
  discounts:   { strategy: "parentChild", buildRows: buildDiscountBulkRows },
  pages:       { strategy: "flat", normalize: normalizePage },
  blogs:       { strategy: "flat", normalize: normalizeBlog },
  articles:    { strategy: "flat", normalize: normalizeArticle },
  redirects:   { strategy: "flat", normalize: normalizeRedirect },
  files:       { strategy: "flat", normalize: normalizeFile },
  // Companies: locations stream as child lines; rebuild company.locations,
  // then flatten to one row per location (mirrors the direct path).
  companies:   { strategy: "parentChild", buildRows: buildCompanyBulkRows },
  // Draft orders: lineItems stream as child lines; one row per line item.
  draft_orders: { strategy: "parentChild", normalize: normalizeDraftOrder },
};

/**
 * Rebuild a company from its bulk parent line plus its CompanyLocation child
 * lines (the `locations` connection is flattened by bulk), then produce one
 * row per location via buildCompanyRows.
 */
function buildCompanyBulkRows(parent, children) {
  const locations = children.filter((c) => gidType(c.id) === "CompanyLocation");
  return buildCompanyRows({ ...parent, locations: { nodes: locations } });
}

/**
 * Rebuild a discount node from its bulk parent line plus its DiscountRedeemCode
 * child lines (the `codes` connection is flattened by bulk), then normalize it
 * into a single row — mirroring the direct path's one-row-per-discount shape.
 */
function buildDiscountBulkRows(parent, children) {
  const codes = children.filter((c) => gidType(c.id) === "DiscountRedeemCode");
  const node = { ...parent, discount: { ...parent.discount, codes: { nodes: codes } } };
  return [normalizeDiscount(node)];
}

/** Type segment of a Shopify gid, e.g. "ProductVariant" from gid://shopify/ProductVariant/1. */
function gidType(gid) {
  const m = /^gid:\/\/shopify\/([^/]+)\//.exec(String(gid ?? ""));
  return m ? m[1] : "";
}

/**
 * Rebuild a nested product object from a bulk JSONL parent line plus its
 * flat descendant lines. Children are classified by gid type; media lines
 * are split between the product and its variants by __parentId. The result
 * matches the shape buildProductRows/normalizeProduct expect from the
 * direct GraphQL path.
 */
function assembleProduct(parent, children) {
  const variants = [];
  const productMedia = [];
  const productMetafields = [];
  const collections = [];
  const variantMedia = new Map();      // variantId → media node[]
  const variantMetafields = new Map(); // variantId → metafield node[]
  const inventoryLevels = new Map();   // inventoryItemId → inventory level node[]

  for (const child of children) {
    const type = gidType(child.id);
    if (type === "ProductVariant") {
      variants.push(child);
    } else if (type === "Collection") {
      collections.push(child);
    } else if (type === "InventoryLevel") {
      // __parentId is the variant's inventoryItem id (inline on the variant).
      const list = inventoryLevels.get(child.__parentId) ?? [];
      list.push(child);
      inventoryLevels.set(child.__parentId, list);
    } else if (type === "Metafield") {
      // Split between product and variant metafields by __parentId.
      if (child.__parentId === parent.id) {
        productMetafields.push(child);
      } else {
        const list = variantMetafields.get(child.__parentId) ?? [];
        list.push(child);
        variantMetafields.set(child.__parentId, list);
      }
    } else if (type === "MediaImage") {
      if (child.__parentId === parent.id) {
        productMedia.push(child);
      } else {
        const list = variantMedia.get(child.__parentId) ?? [];
        list.push(child);
        variantMedia.set(child.__parentId, list);
      }
    }
  }

  for (const v of variants) {
    v.media = { nodes: variantMedia.get(v.id) ?? [] };
    v.metafields = { nodes: variantMetafields.get(v.id) ?? [] };
    if (v.inventoryItem?.id) {
      v.inventoryItem.inventoryLevels = { nodes: inventoryLevels.get(v.inventoryItem.id) ?? [] };
    }
  }

  return {
    ...parent,
    collections: { nodes: collections },
    media:       { nodes: productMedia },
    metafields:  { nodes: productMetafields },
    variants:    { nodes: variants },
  };
}

/** Entities for which bulk operations are supported. */
export const BULK_ENTITIES = Object.keys(BULK_QUERY_BUILDERS);

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Get the store's count for an entity (used to decide direct vs bulk).
 * @returns {Promise<number>}
 */
export async function getEntityCount(admin, entity) {
  // Articles and files have no count query in the Admin API, so we can't size
  // them up front. Treat them as "large" so streamable-format exports route to
  // bulk (the direct path would risk the same query-cost/timeout limits).
  if (entity === "articles" || entity === "files") return Infinity;

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
export async function submitBulkOperation(admin, { entity, query = "", fields }) {
  const builder = BULK_QUERY_BUILDERS[entity];
  if (!builder) throw new Error(`Bulk export not supported for entity: ${entity}`);

  // Products: pull each dynamic sub-selection only when one of its columns is
  // selected (column keys are the human headers).
  const sel = entity === "products" && Array.isArray(fields) ? fields : [];
  const queryOpts = {
    includeInventory: sel.some((f) => f.startsWith("Inventory ")),
    includeMetafields: sel.some((f) => f.startsWith("Metafield: ")),
    includeVariantMetafields: sel.some((f) => f.startsWith("Variant Metafield: ")),
  };

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
    variables: { query: builder(query, queryOpts) },
  });

  const { data } = await res.json();
  const { bulkOperation, userErrors } = data?.bulkOperationRunQuery ?? {};

  if (userErrors?.length) {
    throw new Error(`Bulk operation error: ${userErrors.map((e) => e.message).join(", ")}`);
  }

  return { bulkOperationId: bulkOperation.id };
}
