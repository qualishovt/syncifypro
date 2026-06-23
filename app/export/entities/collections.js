/**
 * export/entities/collections.js
 *
 * Fetches custom + smart collections from Shopify (paginated) as
 * normalized flat rows. One row per collection; smart-collection
 * rules are serialized into a single column.
 */

import { normalizeCollection } from "../normalizer.js";

const COLLECTIONS_QUERY = `#graphql
  query GetCollections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle descriptionHtml sortOrder templateSuffix updatedAt
        productsCount { count }
        image { url altText width height }
        seo { title description }
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
      }
    }
  }
`;

export async function extractCollections(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(COLLECTIONS_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.collections;
    for (const collection of nodes) rows.push(normalizeCollection(collection));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
