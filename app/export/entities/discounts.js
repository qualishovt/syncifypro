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
            title summary status createdAt updatedAt startsAt endsAt
            usageLimit appliesOncePerCustomer asyncUsageCount
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement { __typename
              ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
            }
            codes(first: 10) { nodes { code } }
            customerGets { value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } }
            } }
          }
          ... on DiscountAutomaticBasic {
            title summary status createdAt updatedAt startsAt endsAt asyncUsageCount
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement { __typename
              ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
            }
            customerGets { value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } }
            } }
          }
          ... on DiscountCodeFreeShipping {
            title summary status createdAt updatedAt startsAt endsAt
            usageLimit appliesOncePerCustomer asyncUsageCount
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            codes(first: 10) { nodes { code } }
          }
          ... on DiscountAutomaticFreeShipping {
            title summary status createdAt updatedAt startsAt endsAt asyncUsageCount
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          }
          ... on DiscountCodeBxgy {
            title summary status createdAt updatedAt startsAt endsAt
            usageLimit appliesOncePerCustomer asyncUsageCount
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            codes(first: 10) { nodes { code } }
          }
          ... on DiscountAutomaticBxgy {
            title summary status createdAt updatedAt startsAt endsAt asyncUsageCount
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          }
        }
      }
    }
  }
`;

export async function extractDiscounts(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

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

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
