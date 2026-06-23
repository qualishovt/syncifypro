/**
 * export/entities/metafields.js
 *
 * Exports metafield DEFINITIONS (the schema/config) across owner types. Like
 * metaobjects, `metafieldDefinitions` is queried per owner type, so we loop a
 * fixed set of owner types and paginate each. Requires the relevant read scope
 * per owner resource (already granted for the resources we export).
 */

const OWNER_TYPES = [
  "PRODUCT", "PRODUCTVARIANT", "COLLECTION", "CUSTOMER", "ORDER",
  "COMPANY", "COMPANY_LOCATION", "LOCATION", "MARKET",
];

const DEFS_QUERY = `#graphql
  query GetMetafieldDefs($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id namespace key name description ownerType
        type { name }
        validations { name value }
        metafieldsCount
      }
    }
  }
`;

const gidNum = (g) => String(g ?? "").replace(/^gid:\/\/shopify\/\w+\//, "");

function normalizeMetafieldDef(d) {
  return {
    definition_id:    gidNum(d.id),
    namespace:        d.namespace ?? "",
    key:              d.key ?? "",
    name:             d.name ?? "",
    description:      d.description ?? "",
    owner_type:       d.ownerType ?? "",
    type:             d.type?.name ?? "",
    validations:      (d.validations ?? []).map((v) => `${v.name}: ${v.value}`).join("; "),
    metafields_count: d.metafieldsCount ?? "",
  };
}

export async function extractMetafields(admin) {
  const rows = [];
  for (const ownerType of OWNER_TYPES) {
    let cursor = null;
    let hasNextPage = true;
    while (hasNextPage) {
      let conn;
      try {
        const res = await admin.graphql(DEFS_QUERY, {
          variables: { ownerType, first: 250, after: cursor },
        });
        const { data, errors } = await res.json();
        // An owner type the store doesn't support just yields no definitions —
        // log and skip rather than aborting the whole export.
        if (errors?.length || !data?.metafieldDefinitions) {
          console.warn(`[metafields export] skipped ownerType ${ownerType}: ${errors?.map((e) => e.message).join(", ") ?? "no data"}`);
          break;
        }
        conn = data.metafieldDefinitions;
      } catch (e) {
        console.warn(`[metafields export] skipped ownerType ${ownerType}: ${e.message}`);
        break;
      }
      for (const d of conn.nodes) rows.push(normalizeMetafieldDef(d));
      hasNextPage = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
    }
  }
  return rows;
}
