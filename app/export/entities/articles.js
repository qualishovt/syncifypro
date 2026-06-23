/**
 * export/entities/articles.js
 *
 * Fetches blog articles (blog posts) from Shopify (paginated) as
 * normalized flat rows. Each row carries its parent blog's handle.
 * Requires read_content / read_online_store_pages scope.
 */

import { normalizeArticle } from "../normalizer.js";

const ARTICLES_QUERY = `#graphql
  query GetArticles($first: Int!, $after: String, $query: String) {
    articles(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle body summary isPublished publishedAt
        templateSuffix tags createdAt updatedAt
        author { name }
        blog { id title handle }
        image { url altText }
      }
    }
  }
`;

export async function extractArticles(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(ARTICLES_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.articles;
    for (const article of nodes) rows.push(normalizeArticle(article));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
