/**
 * export/entities/markets.js
 *
 * Markets (international selling regions) as flat rows — one row per market.
 * Requires read_markets.
 */

const MARKETS_QUERY = `#graphql
  query GetMarkets($first: Int!, $after: String) {
    markets(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name handle status }
    }
  }
`;

export async function extractMarkets(admin, { onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(MARKETS_QUERY, {
      variables: { first: 100, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.markets;
    for (const m of nodes) {
      rows.push({
        market_id: m.id?.split("/").pop() ?? "",
        name: m.name ?? "",
        handle: m.handle ?? "",
        status: m.status ?? "",
      });
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
