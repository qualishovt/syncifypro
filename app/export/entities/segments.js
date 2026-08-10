/**
 * export/entities/segments.js
 *
 * Customer segments as flat rows — one row per segment, including the
 * ShopifyQL-ish `query` that defines it. Requires read_customers.
 */

const SEGMENTS_QUERY = `#graphql
  query GetSegments($first: Int!, $after: String) {
    segments(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name query creationDate lastEditDate }
    }
  }
`;

export async function extractSegments(admin, { onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(SEGMENTS_QUERY, {
      variables: { first: 100, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.segments;
    for (const s of nodes) {
      rows.push({
        segment_id: s.id?.split("/").pop() ?? "",
        name: s.name ?? "",
        query: s.query ?? "",
        created_at: s.creationDate ?? "",
        updated_at: s.lastEditDate ?? "",
      });
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
