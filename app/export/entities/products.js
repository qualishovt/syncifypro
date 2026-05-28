/**
 * export/entities/products.js
 *
 * Fetches products from Shopify (paginated) and returns them as
 * normalized flat rows. Accepts an optional Shopify search query
 * string to filter which products are fetched.
 */

import { normalizeProduct } from "../normalizer.js";

// $query filters which products Shopify returns (empty = all products)
const PRODUCTS_QUERY = `#graphql
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
        images(first: 1) {
          nodes {
            url
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
            inventoryItem {
              measurement {
                weight {
                  value
                  unit
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch products from the store, paginating automatically.
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @param {object} [options]
 * @param {string} [options.query] - Shopify search query string (e.g. "status:active vendor:Nike")
 * @returns {Promise<object[]>}
 */
export async function extractProducts(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: {
        first: 250,
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
      // One row per variant — standard Shopify CSV convention
      if (product.variants.nodes.length === 0) {
        rows.push(normalizeProduct(product, null));
      } else {
        for (const variant of product.variants.nodes) {
          rows.push(normalizeProduct(product, variant));
        }
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}