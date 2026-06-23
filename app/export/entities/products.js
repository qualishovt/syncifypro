/**
 * export/entities/products.js
 *
 * Fetches products from Shopify (paginated) and returns them as
 * normalized flat rows. Accepts an optional Shopify search query
 * string to filter which products are fetched.
 */

import { buildProductRows } from "../normalizer.js";
import { INVENTORY_QUANTITY_NAMES } from "../inventoryColumns.js";
import { isCatalogColumn, catalogPublishedAlias } from "../catalogColumns.js";
import { fetchCatalogData } from "./catalogPrices.js";

// Products are fetched 100 per page (not 250): each node carries variants,
// media, collections and optional metafield/inventory sub-selections, so the
// requested query cost must stay under Shopify's 1000-point single-query
// limit. Stores >=10k products use bulk operations instead (see exportJob.js).
const PRODUCTS_PAGE_SIZE = 100;

// "Included / <catalog>" comes from a publishedOnPublication boolean aliased
// per catalog (catpub_<i>), built from the fetched catalog publication ids.
// resourcePublicationsV2 isn't used because its catalogType defaults to APP
// and can't return Markets + B2B catalog publications in one selection.
function publishedOnPublicationFields(catalogs = []) {
  return catalogs
    .map((c, i) =>
      c.publicationId
        ? `${catalogPublishedAlias(i)}: publishedOnPublication(publicationId: ${JSON.stringify(c.publicationId)})`
        : "",
    )
    .filter(Boolean)
    .join("\n        ");
}

// Per-location inventory levels — fetched only when the export selects a
// Multi-Location Inventory column, since it's expensive across all variants.
const INVENTORY_LEVELS_FRAGMENT = `
              inventoryLevels(first: 25) {
                nodes {
                  location { name }
                  quantities(names: [${INVENTORY_QUANTITY_NAMES.map((n) => `"${n}"`).join(", ")}]) {
                    name
                    quantity
                  }
                }
              }`;

// Product / variant metafields — fetched only when a (Variant) Metafield
// column is selected. Keyed by namespace.key like the dynamic columns.
const PRODUCT_METAFIELDS_FRAGMENT = `
        metafields(first: 50) { nodes { namespace key value type } }`;
const VARIANT_METAFIELDS_FRAGMENT = `
            metafields(first: 50) { nodes { namespace key value type } }`;

// $query filters which products Shopify returns (empty = all products).
// The flags toggle the (slow) dynamic sub-selections so plain exports stay fast.
function buildProductsQuery({ includeInventory, includeMetafields, includeVariantMetafields, catalogs } = {}) {
  const publicationFields = catalogs?.length ? publishedOnPublicationFields(catalogs) : "";
  return `#graphql
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        status
        descriptionHtml
        vendor
        productType
        tags
        createdAt
        updatedAt
        publishedAt
        templateSuffix
        isGiftCard
        onlineStoreUrl
        totalInventory${includeMetafields ? PRODUCT_METAFIELDS_FRAGMENT : ""}${publicationFields ? `\n        ${publicationFields}` : ""}
        seo { title description }
        category {
          id
          name
          fullName
        }
        collections(first: 250) {
          nodes {
            title
            ruleSet {
              appliedDisjunctively
            }
          }
        }
        media(first: 50) {
          nodes {
            ... on MediaImage {
              id
              mimeType
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            inventoryQuantity
            barcode
            taxable
            position
            inventoryPolicy
            selectedOptions {
              name
              value
            }
            deliveryProfile {
              name
            }${includeVariantMetafields ? VARIANT_METAFIELDS_FRAGMENT : ""}
            media(first: 1) {
              nodes {
                ... on MediaImage {
                  image {
                    url
                  }
                }
              }
            }
            inventoryItem {
              id
              tracked
              requiresShipping
              unitCost {
                amount
              }
              countryCodeOfOrigin
              provinceCodeOfOrigin
              harmonizedSystemCode
              measurement {
                weight {
                  value
                  unit
                }
              }${includeInventory ? INVENTORY_LEVELS_FRAGMENT : ""}
            }
          }
        }
      }
    }
  }
`;
}

/**
 * Fetch products from the store, paginating automatically.
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @param {object} [options]
 * @param {string} [options.query] - Shopify search query string (e.g. "status:active vendor:Nike")
 * @param {string[]} [options.fields] - selected columns; toggles the inventory fetch
 * @returns {Promise<object[]>}
 */
export async function extractProducts(admin, { query = "", fields } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  // Each dynamic group is fetched only when one of its columns is selected,
  // so plain product exports stay fast. Column keys are the human headers.
  const sel = Array.isArray(fields) ? fields : [];
  const includeInventory = sel.some((f) => f.startsWith("Inventory "));
  const includeMetafields = sel.some((f) => f.startsWith("Metafield: "));
  const includeVariantMetafields = sel.some((f) => f.startsWith("Variant Metafield: "));
  const includeCatalogs = sel.some(isCatalogColumn);

  // Fetch catalog data first — the query aliases publishedOnPublication per
  // catalog ("Included"), and prices are joined per variant afterwards.
  const catalogData = includeCatalogs ? await fetchCatalogData(admin) : undefined;

  const productsQuery = buildProductsQuery({
    includeInventory, includeMetafields, includeVariantMetafields,
    catalogs: catalogData?.catalogs,
  });

  while (hasNextPage) {
    const response = await admin.graphql(productsQuery, {
      variables: {
        first: PRODUCTS_PAGE_SIZE,
        after: cursor,
        // Pass undefined (not "") when no filter — Shopify treats
        // an empty string as a valid-but-empty query in some versions
        query: query || undefined,
      },
    });

    const { data, errors } = await response.json();

    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.products;

    for (const product of nodes) {
      // Matrixify layout: one row per variant, plus extra rows for any
      // images beyond the variant count (shared with the bulk worker).
      for (const row of buildProductRows(product, rows.length + 1, {
        catalogPriceMap: catalogData?.priceMap,
        catalogs: catalogData?.catalogs,
      })) {
        rows.push(row);
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}