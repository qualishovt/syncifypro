/**
 * export/entities/orders.js
 *
 * Fetches all orders from Shopify (paginated) and returns them
 * as normalized flat rows ready for any format adapter.
 * One row per line item — the standard convention for order CSVs.
 */

import { buildOrderRows } from "../normalizer.js";

// Orders are fetched 10 per page: each order node carries lineItems(first: 250)
// plus transactions/refunds/fulfillments sub-entities, so the requested query
// cost scales steeply and must stay under Shopify's 1000-point single-query
// limit. Smaller pages = more requests, but no truncated data.
const ORDERS_PAGE_SIZE = 10;

const ORDERS_QUERY = `#graphql
  query GetOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id name note tags email phone
        createdAt updatedAt processedAt cancelledAt closedAt cancelReason
        displayFinancialStatus displayFulfillmentStatus
        currencyCode presentmentCurrencyCode
        taxesIncluded test confirmed sourceName statusPageUrl
        clientIp sourceIdentifier confirmationNumber
        currentSubtotalLineItemsQuantity totalWeight
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
        risk { recommendation assessments { riskLevel facts { description sentiment } } }
        customerJourneySummary { lastVisit { landingPage referrerUrl source sourceType utmParameters { source medium campaign term content } } }
        purchasingEntity { __typename ... on PurchasingCompany { company { id name } location { id name } } }
        shippingLine { title code source originalPriceSet { shopMoney { amount } } taxLines { title rate priceSet { shopMoney { amount } } } }
        transactions(first: 50) {
          id kind status gateway processedAt accountNumber paymentId errorCode test
          amountSet { shopMoney { amount currencyCode } }
          parentTransaction { id }
        }
        refunds {
          id createdAt note
          totalRefundedSet { shopMoney { amount currencyCode } }
          refundLineItems(first: 5) { nodes { restockType location { name } } }
        }
        fulfillments(first: 30) {
          id status displayStatus createdAt updatedAt totalQuantity
          service { handle }
          location { name }
          trackingInfo { company number url }
        }
        billingAddress {
          firstName lastName name company phone
          address1 address2 city province provinceCode zip country countryCodeV2
        }
        shippingAddress {
          firstName lastName name company phone
          address1 address2 city province provinceCode zip country countryCodeV2
        }
        customer {
          id firstName lastName note state numberOfOrders taxExempt tags
          defaultEmailAddress { emailAddress marketingState }
          defaultPhoneNumber { phoneNumber marketingState }
          amountSpent { amount currencyCode }
        }
        lineItems(first: 250) {
          nodes {
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
              inventoryItem {
                unitCost { amount }
                measurement { weight { value unit } }
                countryCodeOfOrigin harmonizedSystemCode provinceCodeOfOrigin
              }
            }
            product { id handle productType tags }
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
      variables: { first: ORDERS_PAGE_SIZE, after: cursor, query },
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

    // Matrixify-style multi-row: line items + transaction/refund/fulfillment
    // rows per order, tagged by the line_type column.
    for (const order of nodes) {
      for (const row of buildOrderRows(order)) rows.push(row);
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}