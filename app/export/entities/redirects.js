/**
 * export/entities/redirects.js
 *
 * Fetches URL redirects from Shopify (paginated) as normalized flat rows.
 * One row per redirect. Requires the read_online_store_navigation scope.
 */

import { normalizeRedirect } from "../normalizer.js";

const REDIRECTS_QUERY = `#graphql
  query GetRedirects($first: Int!, $after: String, $query: String) {
    urlRedirects(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes { id path target }
    }
  }
`;

export async function extractRedirects(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(REDIRECTS_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.urlRedirects;
    for (const redirect of nodes) rows.push(normalizeRedirect(redirect));

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
