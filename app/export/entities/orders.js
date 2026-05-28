/**
 * export/entities/orders.js
 *
 * Fetches all orders from Shopify (paginated) and returns them
 * as normalized flat rows ready for any format adapter.
 * One row per line item — the standard convention for order CSVs.
 */

import { normalizeOrder } from "../normalizer.js";

const ORDERS_QUERY = `#graphql
  query GetOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        email
        phone
        createdAt
        updatedAt
        processedAt
        cancelledAt
        cancelReason
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        subtotalPriceSet {
          shopMoney { amount currencyCode }
        }
        totalTaxSet {
          shopMoney { amount currencyCode }
        }
        totalShippingPriceSet {
          shopMoney { amount currencyCode }
        }
        totalDiscountsSet {
          shopMoney { amount currencyCode }
        }
        note
        tags
        billingAddress {
          firstName lastName company
          address1 address2
          city province zip country
          phone
        }
        shippingAddress {
          firstName lastName company
          address1 address2
          city province zip country
          phone
        }
        customer {
          id
          firstName
          lastName
          email
        }
        lineItems(first: 250) {
          nodes {
            id
            title
            variantTitle
            quantity
            sku
            vendor
            originalUnitPriceSet {
              shopMoney { amount currencyCode }
            }
            discountedUnitPriceSet {
              shopMoney { amount currencyCode }
            }
            totalDiscountSet {
              shopMoney { amount currencyCode }
            }
            taxable
            requiresShipping
            fulfillmentStatus
            variant {
              id
            }
            product {
              id
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch all orders from the store, paginating automatically.
 * Returns an array of normalized flat row objects (one per line item).
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @returns {Promise<object[]>}
 */
export async function extractOrders(admin, { query = "status:any" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: 250, after: cursor, query },
    });

    const { data, errors } = await response.json();

    // Shopify returns HTTP 200 with both data AND errors when fields are
    // redacted due to Protected Customer Data. In that case `data` is still
    // usable (PII fields just come back null), so we log a warning rather
    // than throwing. We only throw when there's no usable data at all.
    if (errors?.length) {
      const messages = errors.map((e) => e.message).join(", ");
      if (!data?.orders) {
        throw new Error(`Shopify API error: ${messages}`);
      }
      console.warn(`[orders export] Some fields redacted by Shopify: ${messages}`);
    }

    const { nodes, pageInfo } = data.orders;

    for (const order of nodes) {
      // One row per line item — standard order CSV convention
      if (order.lineItems.nodes.length === 0) {
        rows.push(normalizeOrder(order, null));
      } else {
        for (const lineItem of order.lineItems.nodes) {
          rows.push(normalizeOrder(order, lineItem));
        }
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}