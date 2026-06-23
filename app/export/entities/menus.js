/**
 * export/entities/menus.js
 *
 * Fetches online-store navigation menus (paginated) and flattens each menu's
 * (recursively nested) items into one row per item, carrying the parent menu's
 * fields and the item's nesting level. Requires read_online_store_navigation.
 * Menus are few per store, so there's no bulk path or count.
 */

import { buildMenuRows } from "../normalizer.js";

const MENUS_QUERY = `#graphql
  query GetMenus($first: Int!, $after: String) {
    menus(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title isDefault
        items {
          id title type url resourceId tags
          items {
            id title type url resourceId tags
            items { id title type url resourceId tags }
          }
        }
      }
    }
  }
`;

export async function extractMenus(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(MENUS_QUERY, {
      variables: { first: 250, after: cursor },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.menus;
    for (const menu of nodes) rows.push(...buildMenuRows(menu));

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
