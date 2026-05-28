/**
 * export/entities/products.js
 *
 * Fetches all products from Shopify (paginated) and returns
 * them as normalized flat rows ready for any format adapter.
 */

import { normalizeProduct } from "../normalizer.js";

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
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
 * Fetch all products from the store, paginating automatically.
 * Returns an array of normalized flat row objects.
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @returns {Promise<object[]>}
 */
export async function extractProducts(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: 250, after: cursor },
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