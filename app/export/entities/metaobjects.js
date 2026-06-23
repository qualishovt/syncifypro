/**
 * export/entities/metaobjects.js
 *
 * Metaobjects are organized by type (definition). The `metaobjects` query
 * requires a type, so we first fetch every definition's type, then paginate
 * the objects of each type. Each object's (type-dependent) fields are
 * serialized into a single "fields" column. Requires read_metaobjects.
 */

/** Strip "gid://shopify/Metaobject/123" → "123". */
const gidNum = (g) => String(g ?? "").replace(/^gid:\/\/shopify\/\w+\//, "");

const DEFS_QUERY = `#graphql
  query GetMetaobjectDefs($after: String) {
    metaobjectDefinitions(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { type }
    }
  }
`;

const OBJECTS_QUERY = `#graphql
  query GetMetaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle type displayName updatedAt
        fields { key value }
      }
    }
  }
`;

function normalizeMetaobject(mo) {
  return {
    metaobject_id: gidNum(mo.id),
    handle:        mo.handle ?? "",
    type:          mo.type ?? "",
    display_name:  mo.displayName ?? "",
    fields:        (mo.fields ?? []).map((f) => `${f.key}: ${f.value}`).join("; "),
    updated_at:    mo.updatedAt ?? "",
  };
}

export async function extractMetaobjects(admin) {
  // 1. Collect every metaobject definition type (paginated).
  const types = [];
  let defCursor = null;
  let moreDefs = true;
  while (moreDefs) {
    const res = await admin.graphql(DEFS_QUERY, { variables: { after: defCursor } });
    const { data, errors } = await res.json();
    if (errors?.length) throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    const conn = data.metaobjectDefinitions;
    for (const d of conn.nodes) types.push(d.type);
    moreDefs = conn.pageInfo.hasNextPage;
    defCursor = conn.pageInfo.endCursor;
  }

  // 2. Page through every object of each type.
  const rows = [];
  for (const type of types) {
    let cursor = null;
    let hasNextPage = true;
    while (hasNextPage) {
      const res = await admin.graphql(OBJECTS_QUERY, {
        variables: { type, first: 250, after: cursor },
      });
      const { data, errors } = await res.json();
      if (errors?.length) throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
      const conn = data.metaobjects;
      for (const mo of conn.nodes) rows.push(normalizeMetaobject(mo));
      hasNextPage = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
    }
  }

  return rows;
}
