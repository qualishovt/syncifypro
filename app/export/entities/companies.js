/**
 * export/entities/companies.js
 *
 * Fetches B2B companies (paginated) and flattens each company's locations into
 * one row per location, carrying the company-level fields. Requires
 * read_companies (+ read_customers for the main contact).
 */

import { buildCompanyRows } from "../normalizer.js";

const COMPANIES_QUERY = `#graphql
  query GetCompanies($first: Int!, $after: String, $query: String) {
    companies(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name externalId note createdAt updatedAt
        contactsCount { count }
        ordersCount { count }
        totalSpent { amount currencyCode }
        mainContact { id customer { id displayName defaultEmailAddress { emailAddress } } }
        locations(first: 50) {
          nodes {
            id name externalId phone note
            billingAddress { address1 address2 city province zip country countryCode phone recipient }
            shippingAddress { address1 address2 city province zip country countryCode phone recipient }
          }
        }
      }
    }
  }
`;

export async function extractCompanies(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(COMPANIES_QUERY, {
      variables: { first: 100, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.companies;
    for (const company of nodes) rows.push(...buildCompanyRows(company));

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
