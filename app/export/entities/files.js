/**
 * export/entities/files.js
 *
 * Fetches files (images, generic files, videos) from Shopify (paginated) as
 * normalized flat rows. One row per file. Requires the read_files scope.
 * `files` has no count query, so large libraries route to bulk operations.
 */

import { normalizeFile } from "../normalizer.js";

const FILES_QUERY = `#graphql
  query GetFiles($first: Int!, $after: String, $query: String) {
    files(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename id alt fileStatus createdAt updatedAt
        ... on MediaImage { mimeType originalSource { fileSize } image { url width height } }
        ... on GenericFile { mimeType originalFileSize url }
        ... on Video { duration originalSource { url fileSize width height mimeType } }
      }
    }
  }
`;

export async function extractFiles(admin, { query = "" } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(FILES_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.files;
    for (const file of nodes) rows.push(normalizeFile(file));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
