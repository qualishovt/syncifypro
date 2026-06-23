/**
 * export/entities/inventoryTransfers.js
 *
 * Fetches inventory transfers (paginated) as flat rows, one per transfer
 * (header-level: origin/destination/status). Requires read_inventory_transfers.
 */

const TRANSFERS_QUERY = `#graphql
  query GetInventoryTransfers($first: Int!, $after: String) {
    inventoryTransfers(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name status referenceName dateCreated
        origin { location { name } }
        destination { location { name } }
      }
    }
  }
`;

const gidNum = (g) => String(g ?? "").replace(/^gid:\/\/shopify\/\w+\//, "");

function normalizeInventoryTransfer(t) {
  return {
    transfer_id:          gidNum(t.id),
    name:                 t.name ?? "",
    status:               t.status ?? "",
    reference_name:       t.referenceName ?? "",
    origin_location:      t.origin?.location?.name ?? "",
    destination_location: t.destination?.location?.name ?? "",
    date_created:         t.dateCreated ?? "",
  };
}

export async function extractInventoryTransfers(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(TRANSFERS_QUERY, {
      variables: { first: 250, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }
    const { nodes, pageInfo } = data.inventoryTransfers;
    for (const t of nodes) rows.push(normalizeInventoryTransfer(t));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
