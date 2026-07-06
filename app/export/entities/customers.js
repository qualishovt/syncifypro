/**
 * export/entities/customers.js
 *
 * Fetches customers from Shopify (paginated) as normalized flat rows.
 * One row per customer with the default address flattened inline, plus
 * first/last order and store-credit balance. Requires read_customers,
 * read_orders, read_store_credit_accounts (+ Protected Customer Data access).
 */

import { normalizeCustomer } from "../normalizer.js";

// 50 per page (not 250): each customer node carries three nested first:1
// connections (first order, last order, store credit), so the requested
// query cost must stay under Shopify's 1000-point single-query limit.
const CUSTOMERS_PAGE_SIZE = 50;

const CUSTOMERS_QUERY = `#graphql
  query GetCustomers($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id firstName lastName note tags locale taxExempt verifiedEmail state
        createdAt updatedAt numberOfOrders multipassIdentifier
        taxExemptions dataSaleOptOut lifetimeDuration productSubscriberStatus
        amountSpent { amount currencyCode }
        defaultEmailAddress { emailAddress marketingState marketingOptInLevel marketingUpdatedAt }
        defaultPhoneNumber { phoneNumber marketingState marketingOptInLevel marketingUpdatedAt marketingCollectedFrom }
        defaultAddress {
          id firstName lastName company phone
          address1 address2 city province provinceCode zip country countryCodeV2
        }
        storeCreditAccounts(first: 1) { nodes { balance { amount currencyCode } } }
        firstOrder: orders(first: 1, sortKey: CREATED_AT) { nodes { id name processedAt totalPriceSet { shopMoney { amount } } } }
        lastOrder: orders(first: 1, sortKey: CREATED_AT, reverse: true) { nodes { id name processedAt totalPriceSet { shopMoney { amount } } } }
      }
    }
  }
`;

export async function extractCustomers(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(CUSTOMERS_QUERY, {
      variables: { first: CUSTOMERS_PAGE_SIZE, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.customers;
    for (const customer of nodes) rows.push(normalizeCustomer(customer));

    processed += nodes.length;
    onProgress?.(processed);

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
