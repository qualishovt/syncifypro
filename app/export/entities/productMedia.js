/**
 * export/entities/productMedia.js
 *
 * Product media as flat rows — ONE ROW PER MEDIA ITEM (image, video,
 * external video, 3D model), keyed to its product. This is the sheet a
 * merchant uses to audit or bulk-replace imagery. Requires read_products.
 */

const PRODUCT_MEDIA_QUERY = `#graphql
  query GetProductMedia($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title
        media(first: 50) {
          nodes {
            id mediaContentType alt status
            ... on MediaImage { image { url width height } }
            ... on Video { sources { url format mimeType } }
            ... on ExternalVideo { embedUrl host }
            ... on Model3d { sources { url format mimeType } }
          }
        }
      }
    }
  }
`;

export async function extractProductMedia(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCT_MEDIA_QUERY, {
      variables: { first: 50, after: cursor, query: query || undefined },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.products;
    for (const p of nodes) {
      (p.media?.nodes ?? []).forEach((m, i) => {
        const src = m.image?.url ?? m.sources?.[0]?.url ?? m.embedUrl ?? "";
        rows.push({
          product_id: p.id?.split("/").pop() ?? "",
          handle: p.handle ?? "",
          product_title: p.title ?? "",
          media_id: m.id?.split("/").pop() ?? "",
          position: i + 1,
          media_type: m.mediaContentType ?? "",
          media_url: src,
          alt: m.alt ?? "",
          media_status: m.status ?? "",
          width: m.image?.width ?? "",
          height: m.image?.height ?? "",
          media_format: m.sources?.[0]?.format ?? m.host ?? "",
        });
      });
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
