/**
 * export/entities/inventory.js
 *
 * Inventory levels as flat rows — ONE ROW PER (inventory item × location),
 * which is the shape a merchant edits to restock. Quantity states come from
 * the `quantities(names:)` API (available / on_hand / committed / incoming).
 * Requires read_inventory (+ read_products for the variant/product labels).
 */

const INVENTORY_QUERY = `#graphql
  query GetInventory($first: Int!, $after: String, $query: String) {
    inventoryItems(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        tracked
        requiresShipping
        countryCodeOfOrigin
        harmonizedSystemCode
        unitCost { amount currencyCode }
        measurement { weight { value unit } }
        variant { id title sku product { id title handle } }
        inventoryLevels(first: 20) {
          nodes {
            id
            location { id name }
            quantities(names: ["available", "on_hand", "committed", "incoming"]) { name quantity }
          }
        }
      }
    }
  }
`;

export async function extractInventory(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(INVENTORY_QUERY, {
      variables: { first: 100, after: cursor, query: query || undefined },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.inventoryItems;
    for (const item of nodes) {
      const levels = item.inventoryLevels?.nodes ?? [];
      if (levels.length === 0) {
        rows.push(inventoryRow(item, null));
      } else {
        for (const level of levels) rows.push(inventoryRow(item, level));
      }
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}

function inventoryRow(item, level) {
  const q = {};
  for (const { name, quantity } of level?.quantities ?? []) q[name] = quantity;
  return {
    inventory_item_id: item.id?.split("/").pop() ?? "",
    sku: item.sku ?? item.variant?.sku ?? "",
    product_title: item.variant?.product?.title ?? "",
    product_handle: item.variant?.product?.handle ?? "",
    variant_title: item.variant?.title ?? "",
    variant_id: item.variant?.id?.split("/").pop() ?? "",
    location: level?.location?.name ?? "",
    location_id: level?.location?.id?.split("/").pop() ?? "",
    available: q.available ?? "",
    on_hand: q.on_hand ?? "",
    committed: q.committed ?? "",
    incoming: q.incoming ?? "",
    tracked: item.tracked === true ? "true" : item.tracked === false ? "false" : "",
    requires_shipping: item.requiresShipping === true ? "true" : item.requiresShipping === false ? "false" : "",
    cost: item.unitCost?.amount ?? "",
    cost_currency: item.unitCost?.currencyCode ?? "",
    country_of_origin: item.countryCodeOfOrigin ?? "",
    hs_code: item.harmonizedSystemCode ?? "",
    weight: item.measurement?.weight?.value ?? "",
    weight_unit: item.measurement?.weight?.unit ?? "",
  };
}
