/**
 * export/entities/locations.js
 *
 * Fetches store locations (paginated) as flat rows, one per location.
 * Requires read_locations.
 */

import { normalizeLocation } from "../normalizer.js";

const LOCATIONS_QUERY = `#graphql
  query GetLocations($first: Int!, $after: String) {
    locations(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name isActive fulfillsOnlineOrders shipsInventory
        address { address1 address2 city province provinceCode zip country countryCode phone }
      }
    }
  }
`;

export async function extractLocations(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(LOCATIONS_QUERY, {
      variables: { first: 250, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }
    const { nodes, pageInfo } = data.locations;
    for (const loc of nodes) rows.push(normalizeLocation(loc));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
