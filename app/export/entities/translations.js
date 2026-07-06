/**
 * export/entities/translations.js
 *
 * Exports the full translatable-content TEMPLATE — one row per
 * (resource, translatable field, locale), for EVERY translatable field whether
 * or not it currently has a translation. This mirrors Matrixify: the export
 * lists everything that can be translated (with the source/original value and
 * an empty translation to fill in), so it doubles as the import template. A
 * store with translatable content but no translations still exports every
 * field (with a blank translation) rather than nothing.
 *
 * Locales are dynamic (shopLocales); the translations sub-selection is built
 * with one aliased `translations(locale:)` per non-primary locale. Queried per
 * resource type. Requires read_translations + read_locales.
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
    .map((loc, i) => `t${i}: translations(locale: ${JSON.stringify(loc)}) { key value locale outdated updatedAt }`)
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

export async function extractTranslations(admin, { onProgress } = {}) {
  // 1. Determine target locales: every non-primary language, whether or not
  //    it's published. Merchants routinely translate a language while it's
  //    still in draft (unpublished), and those translations should still
  //    export — matching Matrixify. Filtering to published-only silently
  //    dropped them (and made the count read 0).
  const lr = await admin.graphql(LOCALES_QUERY);
  const ld = await lr.json();
  const locales = (ld.data?.shopLocales ?? [])
    .filter((l) => !l.primary)
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
        const content = node.translatableContent ?? [];
        const handle = content.find((c) => c.key === "handle")?.value ?? "";
        // Per-locale lookup: field key → its translation for that locale.
        const byLocale = locales.map((_, i) => {
          const map = {};
          for (const t of node[`t${i}`] ?? []) map[t.key] = t;
          return map;
        });
        // One row per translatable field per locale — INCLUDING fields with no
        // translation yet, so the file is a fill-in template, not just a dump
        // of existing translations.
        for (const c of content) {
          for (let i = 0; i < locales.length; i++) {
            const t = byLocale[i][c.key];
            rows.push({
              translatable_type:     resourceType,
              translatable_id:       gidNum(node.resourceId),
              translatable_handle:   handle,
              field:                 c.key,
              original_value:        c.value ?? "",
              translation_locale:    locales[i],
              translated:            t?.value ?? "",
              outdated:              t?.outdated ?? "",
              translation_updated_at: t?.updatedAt ?? "",
            });
          }
        }
      }

      onProgress?.(rows.length);
      hasNextPage = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
    }
  }

  return rows;
}
