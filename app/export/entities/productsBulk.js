/**
 * export/entities/productsBulk.js
 *
 * Submits a Shopify Bulk Operations query for products.
 * Shopify processes it on their infrastructure and notifies
 * your app via webhook when complete.
 *
 * Returns immediately with the bulk operation ID — the actual
 * data arrives later via the webhook → bulkOperationWorker.js.
 *
 * Shopify Bulk Operations docs:
 * https://shopify.dev/docs/api/usage/bulk-operations/queries
 */

const BULK_OPERATION_RUN = `#graphql
  mutation BulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CURRENT_BULK_OPERATION = `#graphql
  query CurrentBulkOperation {
    currentBulkOperation {
      id
      status
      errorCode
      objectCount
      fileSize
      url
    }
  }
`;

/**
 * Builds the bulk query for products with an optional filter.
 * In bulk operations, the row filter goes in the `query:` argument
 * on the products connection (same search syntax as regular queries).
 *
 * @param {string} [filterQuery] - Shopify search string (e.g. "status:active")
 * @returns {string} the full bulk GraphQL query
 */
function buildProductsBulkQuery(filterQuery = "") {
  // Escape double quotes in the filter and embed it if present
  const queryArg = filterQuery
    ? `(query: "${filterQuery.replace(/"/g, '\\"')}")`
    : "";

  return `
    {
      products${queryArg} {
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
          url
        }
        variants {
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
  `;
}

/**
 * Submit a bulk operation for products export.
 * Checks if another bulk operation is already running first.
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @param {object} [options]
 * @param {string} [options.query] - Shopify search filter (e.g. "status:active vendor:Nike")
 * @returns {Promise<{ bulkOperationId: string }>}
 */
export async function submitProductsBulkOperation(admin, { query = "" } = {}) {
  // Check if there's already a bulk operation running
  const currentRes = await admin.graphql(CURRENT_BULK_OPERATION);
  const { data: currentData } = await currentRes.json();
  const current = currentData?.currentBulkOperation;

  if (current && ["CREATED", "RUNNING"].includes(current.status)) {
    throw new Error(
      `A bulk operation is already running (ID: ${current.id}, status: ${current.status}). ` +
      `Please wait for it to complete before starting a new export.`
    );
  }

  // Submit the bulk operation with the filter applied
  const res = await admin.graphql(BULK_OPERATION_RUN, {
    variables: { query: buildProductsBulkQuery(query) },
  });

  const { data } = await res.json();
  const { bulkOperation, userErrors } = data?.bulkOperationRunQuery ?? {};

  if (userErrors?.length) {
    throw new Error(`Bulk operation error: ${userErrors.map((e) => e.message).join(", ")}`);
  }

  return { bulkOperationId: bulkOperation.id };
}

/**
 * Get the count of products in the store.
 * Used to decide whether to use bulk or direct export.
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @returns {Promise<number>}
 */
export async function getProductCount(admin) {
  const res = await admin.graphql(`#graphql
    query ProductCount {
      productsCount {
        count
      }
    }
  `);
  const { data } = await res.json();
  return data?.productsCount?.count ?? 0;
}