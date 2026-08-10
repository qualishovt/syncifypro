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

// staffMember needs read_users (restricted) and paymentTerms needs
// read_payment_terms — both are included only when the shop has granted the
// scope, so orders keep exporting (with those columns blank) either way.
const OPTIONAL_FIELDS = {
  read_users: "staffMember { id }",
  read_payment_terms:
    "paymentTerms { paymentTermsType overdue paymentSchedules(first: 1) { nodes { issuedAt dueAt completedAt } } }",
};

async function grantedScopes(admin) {
  try {
    const res = await admin.graphql(
      `#graphql
      query GetAccessScopes { currentAppInstallation { accessScopes { handle } } }`,
    );
    const { data } = await res.json();
    return new Set((data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle));
  } catch {
    return new Set();
  }
}

const buildOrdersQuery = (scopes) => `#graphql
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
        poNumber registeredSourceUrl
        physicalLocation { name }
        ${scopes.has("read_users") ? OPTIONAL_FIELDS.read_users : ""}
        customAttributes { key value }
        ${scopes.has("read_payment_terms") ? OPTIONAL_FIELDS.read_payment_terms : ""}
        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount } presentmentMoney { amount } }
        currentSubtotalPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } presentmentMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } presentmentMoney { amount } }
        currentShippingPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } presentmentMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        totalRefundedSet { shopMoney { amount } presentmentMoney { amount } }
        currentTotalDutiesSet { shopMoney { amount } }
        originalTotalDutiesSet { shopMoney { amount } presentmentMoney { amount } }
        currentTotalAdditionalFeesSet { shopMoney { amount } }
        originalTotalAdditionalFeesSet { shopMoney { amount } presentmentMoney { amount } }
        totalReceivedSet { shopMoney { amount } }
        netPaymentSet { shopMoney { amount } }
        totalCapturableSet { shopMoney { amount } }
        totalOutstandingSet { shopMoney { amount } presentmentMoney { amount } }
        taxLines { title rate ratePercentage channelLiable priceSet { shopMoney { amount } presentmentMoney { amount } } }
        risk { recommendation assessments { riskLevel provider { title } facts { description sentiment } } }
        customerJourneySummary { lastVisit { landingPage referrerUrl source sourceType utmParameters { source medium campaign term content } } }
        purchasingEntity { __typename ... on PurchasingCompany { company { id name externalId } location { id name externalId } } }
        shippingLine { title code source originalPriceSet { shopMoney { amount } } taxLines { title rate priceSet { shopMoney { amount } } } }
        transactions(first: 50) {
          id kind status gateway processedAt accountNumber paymentId errorCode test
          authorizationCode
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
            originalUnitPriceSet { shopMoney { amount } presentmentMoney { amount currencyCode } }
            originalTotalSet { shopMoney { amount } }
            discountedUnitPriceSet { shopMoney { amount } }
            discountedTotalSet { shopMoney { amount } presentmentMoney { amount } }
            totalDiscountSet { shopMoney { amount } presentmentMoney { amount } }
            discountAllocations { allocatedAmountSet { shopMoney { amount } presentmentMoney { amount } } }
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
export async function extractOrders(admin, { query = "status:any", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  const query_ = buildOrdersQuery(await grantedScopes(admin));

  while (hasNextPage) {
    const response = await admin.graphql(query_, {
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

    processed += nodes.length;
    onProgress?.(processed);

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}