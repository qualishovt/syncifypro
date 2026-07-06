/**
 * export/entities/draftOrders.js
 *
 * Fetches draft orders (paginated) as normalized flat rows — one row per line
 * item, mirroring the Orders convention. Requires read_draft_orders.
 */

import { normalizeDraftOrder } from "../normalizer.js";

const DRAFT_ORDERS_QUERY = `#graphql
  query GetDraftOrders($first: Int!, $after: String, $query: String) {
    draftOrders(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
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
        lineItems(first: 250) {
          nodes {
            id title name variantTitle sku vendor quantity requiresShipping taxable isGiftCard
            originalUnitPriceSet { shopMoney { amount } }
            approximateDiscountedUnitPriceSet { shopMoney { amount } }
            customAttributes { key value }
            product { id handle }
            variant { id }
          }
        }
      }
    }
  }
`;

export async function extractDraftOrders(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(DRAFT_ORDERS_QUERY, {
      variables: { first: 50, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.draftOrders;
    for (const draft of nodes) {
      const items = draft.lineItems.nodes;
      if (items.length === 0) rows.push(normalizeDraftOrder(draft, null));
      else for (const lineItem of items) rows.push(normalizeDraftOrder(draft, lineItem));
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
