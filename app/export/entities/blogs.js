/**
 * export/entities/blogs.js
 *
 * Fetches blogs from Shopify (paginated) as normalized flat rows.
 * Blog *articles* are a separate entity (see articles.js).
 * Requires read_content / read_online_store_pages scope.
 */

import { normalizeBlog } from "../normalizer.js";

const BLOGS_QUERY = `#graphql
  query GetBlogs($first: Int!, $after: String, $query: String) {
    blogs(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle templateSuffix commentPolicy createdAt updatedAt
      }
    }
  }
`;

export async function extractBlogs(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(BLOGS_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.blogs;
    for (const blog of nodes) rows.push(normalizeBlog(blog));

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
