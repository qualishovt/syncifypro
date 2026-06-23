/**
 * export/entities/metaobjectDefinitions.js
 *
 * Fetches metaobject DEFINITIONS (the schema) as flat rows — one per
 * definition, with its field definitions serialized. Separate from the
 * metaobject *values* entity. Requires read_metaobject_definitions.
 */

const DEFS_QUERY = `#graphql
  query GetMetaobjectDefinitions($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id type name description metaobjectsCount
        fieldDefinitions { key name required type { name } }
      }
    }
  }
`;

const gidNum = (g) => String(g ?? "").replace(/^gid:\/\/shopify\/\w+\//, "");

function normalizeMetaobjectDefinition(d) {
  return {
    definition_id:     gidNum(d.id),
    type:              d.type ?? "",
    name:              d.name ?? "",
    description:       d.description ?? "",
    metaobjects_count: d.metaobjectsCount ?? "",
    field_definitions: (d.fieldDefinitions ?? [])
      .map((f) => `${f.key} (${f.type?.name ?? ""}${f.required ? ", required" : ""})`)
      .join("; "),
  };
}

export async function extractMetaobjectDefinitions(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(DEFS_QUERY, {
      variables: { first: 250, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }
    const { nodes, pageInfo } = data.metaobjectDefinitions;
    for (const d of nodes) rows.push(normalizeMetaobjectDefinition(d));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
