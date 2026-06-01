/**
 * export/entities/discounts.js
 *
 * Fetches discounts from Shopify (paginated) as normalized flat rows.
 * `discountNodes` returns a union of code/automatic discount types;
 * we request the fields shared across the common variants.
 * Requires the read_discounts scope.
 */

import { normalizeDiscount } from "../normalizer.js";

const DISCOUNTS_QUERY = `#graphql
  query GetDiscounts($first: Int!, $after: String, $query: String) {
    discountNodes(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title status startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            codes(first: 10) { nodes { code } }
            customerGets { value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } }
            } }
          }
          ... on DiscountAutomaticBasic {
            title status startsAt endsAt asyncUsageCount
            customerGets { value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } }
            } }
          }
          ... on DiscountCodeFreeShipping {
            title status startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            codes(first: 10) { nodes { code } }
          }
          ... on DiscountAutomaticFreeShipping {
            title status startsAt endsAt asyncUsageCount
          }
          ... on DiscountCodeBxgy {
            title status startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            codes(first: 10) { nodes { code } }
          }
          ... on DiscountAutomaticBxgy {
            title status startsAt endsAt asyncUsageCount
          }
        }
      }
    }
  }
`;

export async function extractDiscounts(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(DISCOUNTS_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.discountNodes;
    for (const node of nodes) rows.push(normalizeDiscount(node));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
