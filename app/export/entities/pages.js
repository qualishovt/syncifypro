/**
 * export/entities/pages.js
 *
 * Fetches Online Store pages from Shopify (paginated) as normalized
 * flat rows. Requires read_content / read_online_store_pages scope.
 */

import { normalizePage } from "../normalizer.js";

const PAGES_QUERY = `#graphql
  query GetPages($first: Int!, $after: String, $query: String) {
    pages(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle body bodySummary isPublished publishedAt
        templateSuffix createdAt updatedAt
      }
    }
  }
`;

export async function extractPages(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PAGES_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.pages;
    for (const page of nodes) rows.push(normalizePage(page));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
