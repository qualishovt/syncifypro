/**
 * export/entities/customers.js
 *
 * Fetches customers from Shopify (paginated) as normalized flat rows.
 * One row per customer with the default address flattened inline.
 * Requires the read_customers scope (+ Protected Customer Data access).
 */

import { normalizeCustomer } from "../normalizer.js";

const CUSTOMERS_QUERY = `#graphql
  query GetCustomers($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id firstName lastName note tags
        verifiedEmail state createdAt updatedAt
        numberOfOrders
        amountSpent { amount currencyCode }
        defaultEmailAddress { emailAddress marketingState marketingOptInLevel }
        defaultPhoneNumber { phoneNumber }
        defaultAddress {
          address1 address2 city province provinceCode
          zip country countryCodeV2 company phone
        }
      }
    }
  }
`;

export async function extractCustomers(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(CUSTOMERS_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.customers;
    for (const customer of nodes) rows.push(normalizeCustomer(customer));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
