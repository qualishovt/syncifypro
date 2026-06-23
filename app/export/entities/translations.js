/**
 * export/entities/translations.js
 *
 * Exports content translations as one row per (resource, field, locale).
 * Locales are dynamic (shopLocales), so the translations sub-selection is
 * built with one aliased `translations(locale:)` per non-primary published
 * locale — similar to the dynamic catalog columns. Queried per resource type.
 * Requires read_translations + read_locales.
 */

const LOCALES_QUERY = `#graphql
  query Locales { shopLocales { locale primary published } }
`;

// TranslatableResourceType values we sweep. Unsupported ones are skipped at
// runtime (the request errors and we move on), so this list can be generous.
const RESOURCE_TYPES = [
  "PRODUCT", "COLLECTION", "PRODUCT_OPTION", "PRODUCT_OPTION_VALUE",
  "ARTICLE", "BLOG", "PAGE", "LINK", "MENU", "SHOP", "SHOP_POLICY",
  "METAFIELD", "METAOBJECT", "FILTER", "DELIVERY_METHOD_DEFINITION",
  "SELLING_PLAN", "SELLING_PLAN_GROUP",
];

const gidNum = (g) => String(g ?? "").replace(/^gid:\/\/shopify\/\w+\//, "");

/** Build the per-type query with one aliased translations() per locale. */
function buildTranslationsQuery(locales) {
  const aliases = locales
    .map((loc, i) => `t${i}: translations(locale: ${JSON.stringify(loc)}) { key value locale outdated }`)
    .join("\n          ");
  return `#graphql
    query GetTranslations($resourceType: TranslatableResourceType!, $first: Int!, $after: String) {
      translatableResources(resourceType: $resourceType, first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          resourceId
          translatableContent { key value }
          ${aliases}
        }
      }
    }
  `;
}

export async function extractTranslations(admin) {
  // 1. Determine target locales (published, non-primary).
  const lr = await admin.graphql(LOCALES_QUERY);
  const ld = await lr.json();
  const locales = (ld.data?.shopLocales ?? [])
    .filter((l) => l.published && !l.primary)
    .map((l) => l.locale);
  if (locales.length === 0) return []; // single-locale store: nothing to export

  const query = buildTranslationsQuery(locales);
  const rows = [];

  // 2. Sweep each resource type, paginating, flattening to one row per
  //    (resource, field, locale) that has a translation.
  for (const resourceType of RESOURCE_TYPES) {
    let cursor = null;
    let hasNextPage = true;
    while (hasNextPage) {
      let conn;
      try {
        const res = await admin.graphql(query, {
          variables: { resourceType, first: 100, after: cursor },
        });
        const { data, errors } = await res.json();
        if (errors?.length || !data?.translatableResources) {
          console.warn(`[translations export] skipped ${resourceType}: ${errors?.map((e) => e.message).join(", ") ?? "no data"}`);
          break;
        }
        conn = data.translatableResources;
      } catch (e) {
        console.warn(`[translations export] skipped ${resourceType}: ${e.message}`);
        break;
      }

      for (const node of conn.nodes) {
        const sourceMap = {};
        for (const c of node.translatableContent ?? []) sourceMap[c.key] = c.value;
        for (let i = 0; i < locales.length; i++) {
          for (const t of node[`t${i}`] ?? []) {
            rows.push({
              translatable_type: resourceType,
              translatable_id:   gidNum(node.resourceId),
              field:             t.key ?? "",
              locale:            locales[i],
              source:            sourceMap[t.key] ?? "",
              translated:        t.value ?? "",
              outdated:          t.outdated ?? "",
            });
          }
        }
      }

      hasNextPage = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
    }
  }

  return rows;
}
