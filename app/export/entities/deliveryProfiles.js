/**
 * export/entities/deliveryProfiles.js
 *
 * Shipping (delivery) profiles as flat rows — one row per profile, with its
 * zone/rate counts. Requires read_shipping.
 */

const PROFILES_QUERY = `#graphql
  query GetDeliveryProfiles($first: Int!, $after: String) {
    deliveryProfiles(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name default
        activeMethodDefinitionsCount
        locationsWithoutRatesCount
        originLocationCount
        productVariantsCountV2 { count }
      }
    }
  }
`;

export async function extractDeliveryProfiles(admin, { onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(PROFILES_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.deliveryProfiles;
    for (const p of nodes) {
      rows.push({
        delivery_profile_id: p.id?.split("/").pop() ?? "",
        name: p.name ?? "",
        is_default: p.default === true ? "true" : "false",
        active_rates: p.activeMethodDefinitionsCount ?? "",
        locations_without_rates: p.locationsWithoutRatesCount ?? "",
        origin_locations: p.originLocationCount ?? "",
        variants_count: p.productVariantsCountV2?.count ?? "",
      });
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
