/**
 * export/entities/catalogs.js
 *
 * Fetches catalogs (Market / B2B / App) as flat rows, one per catalog.
 * The catalog subtype is reported via __typename. Requires read_products.
 */

import { normalizeCatalog } from "../normalizer.js";

const CATALOGS_QUERY = `#graphql
  query GetCatalogs($first: Int!, $after: String) {
    catalogs(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title status __typename
        priceList { id name }
        publication { id }
      }
    }
  }
`;

export async function extractCatalogs(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(CATALOGS_QUERY, {
      variables: { first: 250, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }
    const { nodes, pageInfo } = data.catalogs;
    for (const cat of nodes) rows.push(normalizeCatalog(cat));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
