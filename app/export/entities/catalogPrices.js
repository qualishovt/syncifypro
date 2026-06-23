/**
 * export/entities/catalogPrices.js
 *
 * Fetches every catalog's price-list prices and indexes them by variant id,
 * fully paginated (catalogs, then each catalog's prices). Used by both the
 * direct products extractor and the bulk worker to fill the dynamic
 * "Pricing by Catalogs" columns — the contextualPricing context has no
 * catalogId, so per-variant catalog prices aren't reachable in the product
 * query itself; we join them by variant id instead.
 *
 * Server-only (issues admin GraphQL) — keep out of client bundles.
 */

import { catalogPriceKey, catalogCompareKey } from "../catalogColumns.js";

const CATALOGS_PAGE_QUERY = `#graphql
  query ExportCatalogs($first: Int!, $after: String) {
    catalogs(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { __typename id title publication { id } priceList { id } }
    }
  }
`;

const CATALOG_PRICES_QUERY = `#graphql
  query ExportCatalogPrices($id: ID!, $first: Int!, $after: String) {
    catalog(id: $id) {
      priceList {
        prices(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            variant { id }
            price { amount }
            compareAtPrice { amount }
          }
        }
      }
    }
  }
`;

/**
 * Fetch catalog data for the Pricing by Catalogs columns:
 *   - priceMap: variantId → { "Price / <cat>": amount, "Compare At Price / <cat>": amount }
 *   - catalogs: [{ title, publicationId }] used to compute "Included / <cat>"
 * Paginates both catalogs and each catalog's price list.
 *
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @returns {Promise<{ priceMap: Map<string, Object<string,string>>, catalogs: {title:string, publicationId:string}[] }>}
 */
export async function fetchCatalogData(admin) {
  const priceMap = new Map();
  const catalogs = [];

  let catalogCursor = null;
  let moreCatalogs = true;
  while (moreCatalogs) {
    const res = await admin.graphql(CATALOGS_PAGE_QUERY, {
      variables: { first: 50, after: catalogCursor },
    });
    const { data } = await res.json();
    const conn = data?.catalogs;

    for (const cat of conn?.nodes ?? []) {
      // Skip channel-owned AppCatalogs (Online Store, POS, …) — no merchant
      // price list; only Market / B2B catalogs belong in Pricing by Catalogs.
      if (cat.__typename === "AppCatalog") continue;
      catalogs.push({ title: cat.title, publicationId: cat.publication?.id ?? null });
      if (cat?.priceList?.id) await accumulatePrices(admin, cat.id, cat.title, priceMap);
    }

    moreCatalogs = conn?.pageInfo?.hasNextPage ?? false;
    catalogCursor = conn?.pageInfo?.endCursor ?? null;
  }

  return { priceMap, catalogs };
}

/** Page through one catalog's price list, merging prices into the map. */
async function accumulatePrices(admin, catalogId, title, map) {
  let cursor = null;
  let more = true;
  while (more) {
    const res = await admin.graphql(CATALOG_PRICES_QUERY, {
      variables: { id: catalogId, first: 250, after: cursor },
    });
    const { data } = await res.json();
    const conn = data?.catalog?.priceList?.prices;

    for (const p of conn?.nodes ?? []) {
      const vid = p?.variant?.id;
      if (!vid) continue;
      const entry = map.get(vid) ?? {};
      entry[catalogPriceKey(title)] = p.price?.amount ?? "";
      entry[catalogCompareKey(title)] = p.compareAtPrice?.amount ?? "";
      map.set(vid, entry);
    }

    more = conn?.pageInfo?.hasNextPage ?? false;
    cursor = conn?.pageInfo?.endCursor ?? null;
  }
}
