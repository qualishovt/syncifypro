/**
 * app/routes/app.export.jsx
 *
 * The full Export configurator, reached from the "New Export" card on the home
 * page (/app). Its job-status polling targets its own route (`/app/export?jobId=…`).
 *
 * Polaris-styled export page with:
 *   - entity + format pickers
 *   - per-entity row filters
 *   - column selection
 *   - direct or bulk export (auto-switch by store size)
 *   - recent exports table (download links, status)
 *
 * Form inputs use native <select>/<input>/<input type=checkbox> wrapped
 * in Polaris s-section cards. Web-component form events (s-select etc.)
 * don't bind cleanly to React 18's synthetic onChange — using native
 * inputs keeps state handling simple while the page still renders as
 * native Shopify admin via the surrounding s-page/s-section/s-stack.
 */

import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from "react";
import { useFetcher, useLoaderData, useNavigate, useLocation } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import { startExport } from "../export/exportJob.js";
import { extractTranslations } from "../export/entities/translations.js";
import { getJob, countJobsForShop, lastExportPerEntity, latestExportSpec } from "../db/bulkExportJob.server.js";
import { FIELDS_BY_ENTITY, PRODUCT_FIELDS, COLUMN_GROUPS_BY_ENTITY, FIELD_LABELS, placeholderFor, isEntityBlocked } from "../export/fieldLists.js";
import { buildInventoryFieldKeys } from "../export/inventoryColumns.js";
import { buildMetafieldFieldKeys, PRODUCT_MF_PREFIX, VARIANT_MF_PREFIX } from "../export/metafieldColumns.js";
import { buildCatalogFieldKeys } from "../export/catalogColumns.js";
import { ENTITIES, ENTITY_ICONS, entityDisplayName } from "../export/entityMeta.js";
import { buildRemoteUrl } from "../import/urlSource.js";
// Shared web-component bridges (this route also has LOCAL PolarisSelect/
// PolarisTextField helpers with different signatures — hence the aliases).
import SharedTextField from "../components/PolarisTextField.jsx";
import FormatIcon from "../components/FormatIcon.jsx";
import { stableJson } from "../utils/stableJson.js";
import { presetButton } from "../utils/presetButton.js";
import { EXPORT_TEMPLATES, templateById } from "../export/templates.js";

/**
 * Per-entity filter controls — each maps to a key the matching filter
 * builder in export/filters.js understands.
 */
const FILTERS_BY_ENTITY = {
  products: [
    { key: "status", label: "Status", type: "select", options: opts(["active", "draft", "archived"]) },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "e.g. Nike" },
    { key: "productType", label: "Product type", type: "text" },
    { key: "tag", label: "Tag", type: "text", placeholder: "e.g. sale" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
  ],
  orders: [
    { key: "status", label: "Status", type: "select", options: opts(["open", "closed", "cancelled", "any"]) },
    {
      key: "financialStatus", label: "Financial status", type: "select",
      options: opts(["paid", "pending", "refunded", "partially_refunded", "voided"])
    },
    {
      key: "fulfillmentStatus", label: "Fulfillment status", type: "select",
      options: opts(["fulfilled", "unfulfilled", "partial"])
    },
    { key: "tag", label: "Tag", type: "text" },
    { key: "sourceName", label: "Source", type: "text", placeholder: "e.g. web, pos" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ],
  customers: [
    { key: "state", label: "State", type: "select", options: opts(["enabled", "disabled", "invited", "declined"]) },
    { key: "email", label: "Email", type: "text", placeholder: "e.g. @gmail.com" },
    { key: "country", label: "Country", type: "text", placeholder: "e.g. Canada" },
    { key: "tag", label: "Tag", type: "text" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ],
  collections: [
    { key: "title", label: "Title", type: "text" },
    { key: "collectionType", label: "Type", type: "select", options: opts(["smart", "custom"]) },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ],
  smart_collections: [
    { key: "title", label: "Title", type: "text" },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ],
  custom_collections: [
    { key: "title", label: "Title", type: "text" },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ],
  discounts: [
    { key: "status", label: "Status", type: "select", options: opts(["active", "expired", "scheduled"]) },
    { key: "title", label: "Title", type: "text" },
  ],
  pages: contentFilters(),
  blogs: contentFilters(),
  articles: contentFilters(),
  redirects: [
    { key: "path", label: "Path", type: "text", placeholder: "e.g. /old-url" },
    { key: "target", label: "Target", type: "text", placeholder: "e.g. /products/new" },
  ],
  shop: [],
  files: [
    { key: "mediaType", label: "Media type", type: "select", options: opts(["IMAGE", "VIDEO", "GENERIC_FILE"]) },
    { key: "status", label: "Status", type: "select", options: opts(["READY", "PROCESSING", "FAILED", "UPLOADED"]) },
    { key: "filename", label: "Filename", type: "text" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
  ],
  payouts: [],
  menus: [],
  companies: [
    { key: "name", label: "Name", type: "text", placeholder: "e.g. Acme Inc." },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
  ],
  draft_orders: [
    { key: "status", label: "Status", type: "select", options: opts(["open", "invoice_sent", "completed"]) },
    { key: "tag", label: "Tag", type: "text" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
  ],
  activity: [],
  metaobjects: [],
  metafields: [],
  translations: [],
  locations: [],
  catalogs: [],
  metaobject_definitions: [],
  inventory_transfers: [],
  definitions: [],
  content: contentFilters(),
};

function opts(values) {
  return values.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
}

// Some product groups are dynamic — their columns depend on the store
// (locations, metafield definitions, catalogs). They're appended to the
// static products config at runtime and left off the default selection
// (each is a slow extra fetch). Column keys are the human headers.
function buildProductDynamicGroups({ locations, productMetafieldDefs, variantMetafieldDefs, catalogs } = {}) {
  const groups = [];
  const inv = buildInventoryFieldKeys(locations ?? []);
  if (inv.length) groups.push({ label: "Locations", speed: "Slow", fields: inv });

  const pmf = buildMetafieldFieldKeys(productMetafieldDefs ?? [], PRODUCT_MF_PREFIX);
  if (pmf.length) groups.push({ label: "Metadata", speed: "Slow", fields: pmf });

  const vmf = buildMetafieldFieldKeys(variantMetafieldDefs ?? [], VARIANT_MF_PREFIX);
  if (vmf.length) groups.push({ label: "Variant Metadata", speed: "Slow", fields: vmf });

  const cat = buildCatalogFieldKeys(catalogs ?? []);
  if (cat.length) groups.push({ label: "Markets", speed: "Slow", fields: cat });

  return groups;
}

// Stable empty reference for entities without dynamic groups.
const EMPTY_DYN_GROUPS = [];

/** Full column list for an entity, including its dynamic group keys. */
function allFieldsFor(entity, dynGroups) {
  const base = FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS;
  const dyn = dynGroups.flatMap((g) => g.fields);
  return dyn.length ? [...base, ...dyn] : base;
}

/** Column groups for an entity, with its dynamic groups appended. */
function groupsFor(entity, dynGroups) {
  const base = COLUMN_GROUPS_BY_ENTITY[entity]
    ?? [{ label: "All", fields: FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS }];
  return dynGroups.length ? [...base, ...dynGroups] : base;
}

function contentFilters() {
  return [
    { key: "title", label: "Title", type: "text" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ];
}

// ─── Loader ───────────────────────────────────────────────────────────────────
// Two responsibilities:
//   - When ?jobId=… is present → return that single bulk job's status (polling).
//   - Always → return the recent-exports list for the shop.

// One request fetches every entity's record count. Several resources have no
// top-level *Count query in the Admin API — those are counted via other routes
// (see getDerivedCounts) or left as "—" when no count is obtainable.
const ENTITY_COUNTS_QUERY = `#graphql
  query EntityCounts {
    productsCount { count }
    ordersCount { count }
    customersCount { count }
    collectionsCount { count }
    smartCollectionsCount: collectionsCount(query: "collection_type:smart") { count }
    customCollectionsCount: collectionsCount(query: "collection_type:custom") { count }
    discountNodesCount { count }
    pagesCount { count }
    blogsCount { count }
    urlRedirectsCount { count }
    companiesCount { count }
    draftOrdersCount { count }
    locationsCount { count }
    catalogsCount { count }
    giftCardsCount { count }
  }
`;

const COUNT_FIELD_BY_ENTITY = {
  products: "productsCount",
  orders: "ordersCount",
  customers: "customersCount",
  collections: "collectionsCount",
  smart_collections: "smartCollectionsCount",
  custom_collections: "customCollectionsCount",
  discounts: "discountNodesCount",
  pages: "pagesCount",
  blogs: "blogsCount",
  redirects: "urlRedirectsCount",
  gift_cards: "giftCardsCount",
  companies: "companiesCount",
  draft_orders: "draftOrdersCount",
  locations: "locationsCount",
  catalogs: "catalogsCount",
};

/**
 * Returns { entity → count } for every entity with a count query. Any
 * entity whose scope is missing (partial GraphQL data) or that has no
 * count query resolves to null, which the UI renders as "—".
 */
async function getEntityCounts(admin) {
  try {
    const response = await admin.graphql(ENTITY_COUNTS_QUERY);
    const { data } = await response.json();
    const counts = {};
    for (const [entity, field] of Object.entries(COUNT_FIELD_BY_ENTITY)) {
      counts[entity] = data?.[field]?.count ?? null;
    }
    return counts;
  } catch {
    return {};
  }
}

// Counts for entities Shopify has no direct *Count query for, but which can be
// derived cheaply:
//   metaobjects → sum of each definition's metaobjectsCount
//   content     → pages + the sum of every blog's articlesCount (content is the
//                 merged pages+articles sheet)
// Fetched separately from getEntityCounts so a scope/field failure here can't
// blank the primary counts — each derived value is only set when its data
// actually resolved (otherwise the entity stays "—").
const DERIVED_COUNTS_QUERY = `#graphql
  query DerivedCounts {
    metaobjectDefinitions(first: 250) { nodes { metaobjectsCount } }
    blogArticleCounts: blogs(first: 250) { nodes { articlesCount { count } } }
    menus(first: 250) { nodes { id } pageInfo { hasNextPage } }
  }
`;

async function getDerivedCounts(admin, pagesCount) {
  try {
    const response = await admin.graphql(DERIVED_COUNTS_QUERY);
    const { data } = await response.json();
    const out = {};

    const defNodes = data?.metaobjectDefinitions?.nodes;
    if (defNodes) out.metaobjects = defNodes.reduce((sum, n) => sum + (n.metaobjectsCount ?? 0), 0);

    const blogNodes = data?.blogArticleCounts?.nodes;
    if (blogNodes) {
      const articles = blogNodes.reduce((sum, n) => sum + (n.articlesCount?.count ?? 0), 0);
      out.articles = articles;
      out.content = (pagesCount ?? 0) + articles;
    }

    // Menus have no *Count query; a store has only a handful, so one page is
    // exact. Show "250+" in the unlikely event of more.
    const menuNodes = data?.menus?.nodes;
    if (menuNodes) {
      out.menus = data.menus.pageInfo?.hasNextPage ? "250+" : menuNodes.length;
    }
    return out;
  } catch {
    return {};
  }
}

// Counts for the entities with neither a *Count query nor a derived route.
// Each is read from one page of nodes: stores rarely exceed the page size,
// and when one does the count renders as "N+" instead of a wrong number.
// Split into three requests so no single one busts the query-cost budget,
// and each fails soft — a missing scope only blanks its own entities.
const STRUCTURE_COUNTS_QUERY = `#graphql
  query StructureCounts {
    productVariantsCount { count }
    segmentsCount { count }
    markets(first: 50) { nodes { id } pageInfo { hasNextPage } }
    deliveryProfiles(first: 50) { nodes { id } pageInfo { hasNextPage } }
    inventoryTransfers(first: 100) { nodes { id } pageInfo { hasNextPage } }
    sellingPlanGroups(first: 25) {
      nodes { sellingPlans(first: 25) { nodes { id } pageInfo { hasNextPage } } }
      pageInfo { hasNextPage }
    }
  }
`;
const VOLUME_COUNTS_QUERY = `#graphql
  query VolumeCounts {
    files(first: 100) { nodes { id } pageInfo { hasNextPage } }
    shopifyPaymentsAccount { payouts(first: 100) { nodes { id } pageInfo { hasNextPage } } }
    customers(first: 50) {
      nodes { storeCreditAccounts(first: 5) { nodes { id } } }
      pageInfo { hasNextPage }
    }
  }
`;
const DEFINITION_COUNTS_QUERY = `#graphql
  query DefinitionCounts {
    mdProduct: metafieldDefinitions(ownerType: PRODUCT, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdVariant: metafieldDefinitions(ownerType: PRODUCTVARIANT, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdCollection: metafieldDefinitions(ownerType: COLLECTION, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdCustomer: metafieldDefinitions(ownerType: CUSTOMER, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdOrder: metafieldDefinitions(ownerType: ORDER, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdCompany: metafieldDefinitions(ownerType: COMPANY, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdCompanyLocation: metafieldDefinitions(ownerType: COMPANY_LOCATION, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdLocation: metafieldDefinitions(ownerType: LOCATION, first: 50) { nodes { id } pageInfo { hasNextPage } }
    mdMarket: metafieldDefinitions(ownerType: MARKET, first: 50) { nodes { id } pageInfo { hasNextPage } }
    metaobjectDefinitions(first: 100) { nodes { id } pageInfo { hasNextPage } }
  }
`;

// A capped count keeps its number but gains a "+" so it can't read as exact.
const plusCap = (n, hasMore) => (hasMore ? `${n}+` : n);

// product_media: exact sum of every product's mediaCount. Pages of 250 keep
// the request count low; a 20-page ceiling (5,000 products) stops a giant
// catalog from stalling the loader — past it the count degrades to "N+".
const PRODUCT_MEDIA_COUNT_QUERY = `#graphql
  query ProductMediaCount($after: String) {
    products(first: 250, after: $after) {
      nodes { mediaCount { count } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
async function countProductMedia(admin) {
  let total = 0;
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const response = await admin.graphql(PRODUCT_MEDIA_COUNT_QUERY, { variables: { after: cursor } });
    const conn = (await response.json()).data?.products;
    if (!conn) return null;
    total += conn.nodes.reduce((sum, p) => sum + (p.mediaCount?.count ?? 0), 0);
    if (!conn.pageInfo?.hasNextPage) return total;
    cursor = conn.pageInfo.endCursor;
  }
  return `${total}+`;
}

async function getExtraCounts(admin) {
  const run = async (q) => {
    const response = await admin.graphql(q);
    return (await response.json()).data;
  };
  const [structure, volume, defs, productMedia] = await Promise.all([
    run(STRUCTURE_COUNTS_QUERY).catch(() => null),
    run(VOLUME_COUNTS_QUERY).catch(() => null),
    run(DEFINITION_COUNTS_QUERY).catch(() => null),
    countProductMedia(admin).catch(() => null),
  ]);
  const out = {};
  if (productMedia != null) out.product_media = productMedia;

  if (structure) {
    // One inventory row per inventory item, and items track variants 1:1.
    if (structure.productVariantsCount) out.inventory = structure.productVariantsCount.count;
    if (structure.segmentsCount) out.segments = structure.segmentsCount.count;
    if (structure.markets) out.markets = plusCap(structure.markets.nodes.length, structure.markets.pageInfo?.hasNextPage);
    if (structure.deliveryProfiles) out.delivery_profiles = plusCap(structure.deliveryProfiles.nodes.length, structure.deliveryProfiles.pageInfo?.hasNextPage);
    if (structure.inventoryTransfers) out.inventory_transfers = plusCap(structure.inventoryTransfers.nodes.length, structure.inventoryTransfers.pageInfo?.hasNextPage);
    if (structure.sellingPlanGroups) {
      // The sheet writes one row per plan (or one for an empty group).
      const groups = structure.sellingPlanGroups.nodes;
      const rows = groups.reduce((sum, g) => sum + Math.max(g.sellingPlans?.nodes?.length ?? 0, 1), 0);
      const more = structure.sellingPlanGroups.pageInfo?.hasNextPage
        || groups.some((g) => g.sellingPlans?.pageInfo?.hasNextPage);
      out.selling_plans = plusCap(rows, more);
    }
  }

  if (volume) {
    if (volume.files) out.files = plusCap(volume.files.nodes.length, volume.files.pageInfo?.hasNextPage);
    const payouts = volume.shopifyPaymentsAccount?.payouts;
    if (payouts) out.payouts = plusCap(payouts.nodes.length, payouts.pageInfo?.hasNextPage);
    // A null account is an answer, not an error: no Shopify Payments → 0.
    else if (volume.shopifyPaymentsAccount === null) out.payouts = 0;
    if (volume.customers) {
      const accounts = volume.customers.nodes.reduce((sum, c) => sum + (c.storeCreditAccounts?.nodes?.length ?? 0), 0);
      out.store_credit = plusCap(accounts, volume.customers.pageInfo?.hasNextPage);
    }
  }

  if (defs) {
    // "metafields" = definitions across owner types; "definitions" adds
    // metaobject definitions on top (matching the extractors).
    let mdTotal = 0;
    let mdMore = false;
    for (const [key, conn] of Object.entries(defs)) {
      if (!key.startsWith("md") || !conn) continue;
      mdTotal += conn.nodes?.length ?? 0;
      mdMore = mdMore || Boolean(conn.pageInfo?.hasNextPage);
    }
    out.metafields = plusCap(mdTotal, mdMore);
    const mo = defs.metaobjectDefinitions;
    if (mo) {
      out.definitions = plusCap(mdTotal + (mo.nodes?.length ?? 0), mdMore || Boolean(mo.pageInfo?.hasNextPage));
    }
  }

  return out;
}

// "Translatables" count. No Admin *Count query exists, so a faithful count
// needs the full multi-type sweep — the slowest of all the counts. Counts
// distinct translatable (entity, id, field) — one per translatable field,
// collapsed across locales — matching Matrixify's translatable-content total
// (which counts fields that CAN be translated, not only ones already
// translated). Run concurrently with the other loader queries; returns null on
// failure so the entity falls back to "—".
async function getTranslationsCount(admin) {
  try {
    const rows = await extractTranslations(admin);
    return new Set(
      rows.map((r) => `${r.translatable_type}|${r.translatable_id}|${r.field}`),
    ).size;
  } catch {
    return null;
  }
}

// Drives the dynamic product groups: locations → Multi-Location Inventory,
// metafield definitions → Metafields / Variant Metafields, catalogs → Pricing.
const PRODUCT_DYNAMIC_QUERY = `#graphql
  query ExportProductDynamic {
    locations(first: 50) { nodes { id name } }
    productDefs: metafieldDefinitions(first: 250, ownerType: PRODUCT) { nodes { namespace key type { name } } }
    variantDefs: metafieldDefinitions(first: 250, ownerType: PRODUCTVARIANT) { nodes { namespace key type { name } } }
    catalogs(first: 50) { nodes { __typename title } }
  }
`;

const EMPTY_PRODUCT_DYNAMIC = { locations: [], productMetafieldDefs: [], variantMetafieldDefs: [], catalogs: [] };

async function getProductDynamic(admin) {
  try {
    const response = await admin.graphql(PRODUCT_DYNAMIC_QUERY);
    const { data } = await response.json();
    return {
      locations: data?.locations?.nodes ?? [],
      productMetafieldDefs: data?.productDefs?.nodes ?? [],
      variantMetafieldDefs: data?.variantDefs?.nodes ?? [],
      // Skip channel-owned AppCatalogs (e.g. Online Store, POS) — they carry no
      // merchant price list, so "Pricing by Catalogs" should only surface Market
      // and B2B (company-location) catalogs, matching Matrixify.
      catalogs: (data?.catalogs?.nodes ?? []).filter((c) => c.__typename !== "AppCatalog"),
    };
  } catch {
    return EMPTY_PRODUCT_DYNAMIC;
  }
}

// "2 days ago" for the sheet table's Last-export column.
function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(mo / 12);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/**
 * Starting an export changes none of this page's data, but by default the
 * action would revalidate every loader — including the HEAVY ?data=1 counts
 * fetch — and that reload competes with the job-page navigation for the dev
 * tunnel's connections. Skip it; everything else revalidates as usual.
 */
export function shouldRevalidate({ formData, defaultShouldRevalidate }) {
  if (formData?.get?.("specs")) return false;
  return defaultShouldRevalidate;
}

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const wantData = url.searchParams.get("data") === "1";

  // Saved servers, offered as on-demand delivery targets for a finished export.
  const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
  const servers = (await listImportServers(session.shop)).map(serializeImportServer);

  // Job-status polling (during an export) — no counts needed.
  if (jobId) {
    const job = await getJob(jobId);
    if (!job) return data({ error: "Job not found" }, { status: 404 });
    const polledJob = {
      jobId: job.id,
      status: job.status,
      signedUrl: job.signedUrl,
      filename: `${job.entity}-export.${job.format}`,
      expiresAt: job.signedUrlExpiry?.toISOString() ?? null,
      rowCount: job.rowCount,
      progressCurrent: job.progressCurrent ?? null,
      progressTotal: job.progressTotal ?? null,
      error: job.errorMessage,
    };
    return { polledJob, servers, counts: {}, lastExports: {}, productDynamic: EMPTY_PRODUCT_DYNAMIC, ready: false, presets: [], defaultFormat: "excel", blockedEntities: [], timezone: "UTC" };
  }

  const { listPresets, getPageState } = await import("../db/exportPreset.server.js");
  // The page as it was left: restored before the first paint, so a reload
  // never flashes the defaults.
  const lastState = await getPageState(session.shop).catch(() => null);
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const presets = (await listPresets(session.shop)).map(serializePreset);
  const { defaultExportFormat: defaultFormat, blockedEntities, timezone } = await getAppSettings(session.shop);

  // Duplicate a past export (?duplicate=<jobId>): open this page with that
  // job's configuration loaded but nothing running — tweak, then export.
  let duplicateExport = null;
  const dupId = url.searchParams.get("duplicate");
  if (dupId) {
    const dupJob = await getJob(dupId).catch(() => null);
    if (dupJob && dupJob.shop === session.shop && dupJob.spec) {
      const { parseJobSpec } = await import("../db/bulkExportJob.server.js");
      const parsed = parseJobSpec(dupJob.spec);
      if (parsed.specs) {
        duplicateExport = {
          format: dupJob.format,
          spec: parsed.specs,
          options: parsed.options ?? null,
        };
      }
    }
  }
  // Cheap local query — lets "Latest Export" restore the last run's
  // configuration even on a fresh page load.
  const latestExport = await latestExportSpec(session.shop).catch(() => null);

  // The heavy work — entity row counts + product dynamic columns (several Admin
  // API calls). We DON'T run it on the initial page load, so the page opens
  // instantly; the client immediately re-fetches with ?data=1 to fill it in.
  if (wantData) {
    // Run the independent (and slowest — translations) queries concurrently so
    // the loader waits for the longest, not the sum.
    const [entityCounts, translations, dynamic, lastExports, extraCounts, shopTimezone] = await Promise.all([
      getEntityCounts(admin),
      getTranslationsCount(admin),
      getProductDynamic(admin),
      lastExportPerEntity(session.shop).catch(() => ({})),
      getExtraCounts(admin),
      // The shop's real IANA timezone — pre-selects the scheduler's zone.
      admin.graphql(`#graphql
        query GetShopTimezone { shop { ianaTimezone } }`)
        .then((r) => r.json())
        .then((j) => j?.data?.shop?.ianaTimezone ?? null)
        .catch(() => null),
    ]);
    const counts = entityCounts;
    Object.assign(counts, extraCounts);
    counts.shop = 1; // singleton
    if (translations != null) counts.translations = translations;
    Object.assign(counts, await getDerivedCounts(admin, counts.pages)); // metaobjects, content, menus
    try {
      counts.activity = await countJobsForShop(session.shop); // app-owned entity
    } catch { /* leave as "—" */ }
    return { polledJob: null, servers, counts, lastExports, productDynamic: dynamic, ready: true, presets, defaultFormat, blockedEntities, timezone, shopTimezone, latestExport, duplicateExport, lastState };
  }

  // Initial page load: return the shell instantly. Counts arrive via ?data=1.
  return { polledJob: null, servers, counts: {}, lastExports: {}, productDynamic: EMPTY_PRODUCT_DYNAMIC, ready: false, presets, defaultFormat, blockedEntities, timezone, latestExport, duplicateExport, lastState };
}

// A stored preset → the shape the export UI uses (entityState + format), plus
// the built spec that a Schedule can run.
function serializePreset(p) {
  let state = null, spec = [];
  try { state = p.state ? JSON.parse(p.state) : null; } catch { /* ignore */ }
  try { spec = JSON.parse(p.spec); } catch { /* ignore */ }
  let options = null;
  try { options = p.options ? JSON.parse(p.options) : null; } catch { /* ignore */ }
  return { id: p.id, name: p.name, format: p.format, entityState: state, spec, options };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { getPlan, upgradeError } = await import("../billing.server.js");
  const plan = await getPlan(admin);

  const formData = await request.formData();
  const format = formData.get("format") ?? "csv";
  const intent = formData.get("intent");

  // Save / delete a named export preset (server-persisted so it sticks and can
  // be picked by a Schedule).
  // The page remembering itself: fire-and-forget from the client, so it must
  // never fail the request or return anything the page would re-render for.
  if (intent === "savePageState") {
    const { savePageState } = await import("../db/exportPreset.server.js");
    try {
      await savePageState(session.shop, JSON.parse(String(formData.get("state") || "{}")));
    } catch { /* a page that can't be remembered is not worth an error */ }
    return { stateSaved: true };
  }
  if (intent === "renamePreset" || intent === "duplicatePreset") {
    const mod = await import("../db/exportPreset.server.js");
    const id = String(formData.get("id") || "");
    const res = intent === "renamePreset"
      ? await mod.renamePreset(session.shop, id, String(formData.get("name") || ""))
      : await mod.duplicatePreset(session.shop, id);
    if (res.error) return data({ error: res.error }, { status: 400 });
    const p = res.preset;
    return {
      presetRenamed: intent === "renamePreset" || undefined,
      presetDuplicated: intent === "duplicatePreset" || undefined,
      preset: serializePreset(p),
    };
  }
  if (intent === "savePreset") {
    const { savePreset, RESERVED_NAME } = await import("../db/exportPreset.server.js");
    const name = String(formData.get("name") || "").trim();
    if (!name) return data({ error: "Preset name is required." }, { status: 400 });
    if (RESERVED_NAME.test(name)) {
      return data({ error: "A preset name can't start with two underscores." }, { status: 400 });
    }
    let spec = [], state = null;
    try { spec = JSON.parse(String(formData.get("spec") || "[]")); } catch { /* ignore */ }
    try { state = formData.get("state") ? JSON.parse(String(formData.get("state"))) : null; } catch { /* ignore */ }
    let options = null;
    try { options = formData.get("options") ? JSON.parse(String(formData.get("options"))) : null; } catch { /* ignore */ }
    const p = await savePreset({ shop: session.shop, name, format, spec, state, options });
    return { presetSaved: true, preset: { id: p.id, name: p.name, format: p.format, entityState: state, spec, options } };
  }
  // Deferred "Schedule on": create a schedule from the current configuration
  // WITHOUT running an export now. First run at the given wall-clock time in
  // the shop's display timezone; repeats per the optional interval.
  if (intent === "createInlineSchedule") {
    if (!plan.schedules) return data(upgradeError("Scheduling", session.shop), { status: 402 });
    try {
      const payload = JSON.parse(String(formData.get("payload") || "{}"));
      let specs = Array.isArray(payload.specs) ? payload.specs : [];
      const { getAppSettings } = await import("../db/appSettings.server.js");
      const { isEntityBlocked } = await import("../export/fieldLists.js");
      const { blockedEntities, timezone } = await getAppSettings(session.shop);
      specs = specs.filter((s) => !isEntityBlocked(s.entity, blockedEntities));
      if (specs.length === 0) return data({ error: "Select at least one entity to export." }, { status: 400 });
      const s = payload.schedule ?? {};
      const { createSchedule, zonedDateTimeToUtc } = await import("../db/schedule.server.js");
      // The picked timezone wins; the shop's display timezone is the fallback.
      const tz = typeof s.tz === "string" && s.tz.trim() ? s.tz.trim() : (timezone || "UTC");
      const startAt = zonedDateTimeToUtc(s.date, s.hour, s.minute, tz);
      if (!startAt) return data({ error: "Enter the schedule date as YYYY-MM-DD." }, { status: 400 });
      const okUnits = ["minutes", "hours", "days", "weeks", "months", "years"];
      const interval = s.interval && okUnits.includes(s.interval.unit)
        ? {
            intervalUnit: s.interval.unit,
            intervalCount: Math.max(1, parseInt(String(s.interval.count), 10) || 1),
          }
        : {};
      await createSchedule({
        shop: session.shop, type: "export", enabled: true,
        frequency: "daily", hour: 3, minute: 0,
        startAt, ...interval,
        remainingRuns: s.maxRuns == null ? null : Math.max(1, parseInt(String(s.maxRuns), 10) || 1),
        entity: specs.map((x) => x.entity).join(","),
        format: String(payload.format || "csv"),
        spec: JSON.stringify(specs),
        options: payload.options ? JSON.stringify(payload.options) : null,
        filename: payload.options?.filename ?? null,
        timezone: tz,
      });
      return { scheduled: true };
    } catch (err) {
      return data({ error: `Could not create the schedule: ${err?.message || err}` }, { status: 500 });
    }
  }
  if (intent === "deletePreset") {
    const { deletePreset } = await import("../db/exportPreset.server.js");
    await deletePreset(session.shop, String(formData.get("id")));
    return { presetDeleted: true, id: String(formData.get("id")) };
  }

  // Cancel a running export: flag the job (the worker checks between
  // entities); a Shopify bulk operation is cancelled at Shopify too.
  if (intent === "cancel") {
    const { requestJobCancel, markJobCancelled } = await import("../db/bulkExportJob.server.js");
    const jobId = String(formData.get("jobId"));
    const ok = await requestJobCancel(session.shop, jobId);
    if (!ok) return { cancelRequested: false };
    const job = await getJob(jobId);
    if (job?.bulkOperationId) {
      try {
        await admin.graphql(
          `mutation cancel($id: ID!) { bulkOperationCancel(id: $id) { userErrors { message } } }`,
          { variables: { id: job.bulkOperationId } },
        );
        await markJobCancelled({ id: jobId });
      } catch { /* the flag alone still stops tracked jobs */ }
    }
    return { cancelRequested: true };
  }

  // Per-entity specs: [{ entity, filters?, fields? }, …]
  let specs = [];
  try { specs = JSON.parse(formData.get("specs") ?? "[]"); } catch { /* ignore */ }

  if (!Array.isArray(specs) || specs.length === 0) {
    return data({ error: "Select at least one entity to export." }, { status: 400 });
  }

  // Sheet Permissions (Settings): drop any entity blocked there, so a stale UI
  // or crafted request can't export a disallowed entity.
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const { blockedEntities } = await getAppSettings(session.shop);
  specs = specs.filter((s) => !isEntityBlocked(s.entity, blockedEntities));
  if (specs.length === 0) {
    return data({ error: "Those entities are disabled in Sheet Permissions (Settings)." }, { status: 400 });
  }

  try {
    // Every export runs as a tracked job now (in-process for direct-size,
    // Shopify bulk for huge stores) so the UI can poll for progress.
    // Advanced options: custom file name, skip-when-empty, force zip,
    // post-run delivery to a saved server and/or email.
    const options = {
      filename:      String(formData.get("advFilename") ?? "").trim() || null,
      skipEmpty:     formData.get("advSkipEmpty") === "1",
      zip:           formData.get("advZip") === "1",
      deliverTarget: String(formData.get("advDeliverTarget") ?? "").trim() || null,
      emailTo:       String(formData.get("advEmailTo") ?? "").trim() || null,
    };
    // Per-plan row cap; it rides in options so the worker enforces it wherever
    // the job actually runs. null rowLimit (Enterprise) means uncapped.
    const cappedOptions = plan.rowLimit ? { ...options, maxRows: plan.rowLimit } : options;
    return await startExport({ admin, shop: session.shop, specs, format, options: cappedOptions });
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

// 24 entities — a full 4-per-row grid (Altera-style granularity: collections
// split into all/smart/manual, blog posts separate from the combined content).
// 32 entities — a full 4-per-row grid (8 rows). NB: subscription contracts
// are deliberately absent — reading them needs a scope Shopify only grants
// to approved subscription apps (the extractor is ready if that changes).
const FORMATS = ["excel", "csv", "xml", "json", "pdf", "csv_shopify", "google_feed"];
// Units, counts and run limits for the inline scheduler. The "Repeat every"
// checkbox arms the row; unchecked = one-shot schedule.
const REPEAT_UNITS = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
  { value: "years", label: "years" },
];
const REPEAT_COUNTS = Array.from({ length: 90 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const STOP_AFTER = [
  { value: "until", label: "Until cancelled" },
  ...Array.from({ length: 100 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} run${i ? "s" : ""}` })),
];
const HOURS_00_23 = Array.from({ length: 24 }, (_, i) => {
  const v = String(i).padStart(2, "0");
  return { value: v, label: v };
});
const MINUTES_00_59 = Array.from({ length: 60 }, (_, i) => {
  const v = String(i).padStart(2, "0");
  return { value: v, label: v };
});

// CSV select tokens ↔ the literal characters stored in options.csv.
const CSV_DELIMITERS = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };
const CSV_QUOTES = { double: '"', single: "'" };
const CSV_NEWLINES = { crlf: "\r\n", lf: "\n" };
// "\r\n" typed in a custom field becomes the real control characters.
const unescapeNewline = (s) => s.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
const escapeNewline = (s) => s.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
// Date-time renderings offered in Advanced → Formatting ("" = ISO as-is).
// Which values get the Excel-safety ' prefix (Matrixify-style select).
const APOSTROPHE_OPTIONS = [
  { value: "", label: "— None —" },
  { value: "phones", label: "Phone numbers" },
  { value: "numbers", label: "Numbers" },
  { value: "all", label: "All values" },
];
// Example-labelled like Matrixify's Time format select.
const DATE_FORMATS = [
  { value: "", label: "2026-08-09T04:25:05Z (Default ISO)" },
  { value: "YYYY-MM-DD HH:MM:SS", label: "2026-08-09 04:25:05 (ISO without timezone, Excel friendly)" },
  { value: "YYYY-MM-DD", label: "2026-08-09 (ISO date without time)" },
  { value: "MM/DD/YYYY HH:MM:SS", label: "08/09/2026 04:25:05 (US)" },
  { value: "MM/DD/YYYY HH:MM", label: "08/09/2026 04:25 (US)" },
  { value: "DD.MM.YYYY HH:MM:SS", label: "09.08.2026 04:25:05 (EU)" },
  { value: "DD.MM.YYYY HH:MM", label: "09.08.2026 04:25 (EU)" },
];
const FORMAT_LABELS = {
  csv: "CSV", excel: "Excel", xml: "XML", json: "JSON", pdf: "PDF",
  // Shopify's own column layout, for its built-in importer / another store.
  csv_shopify: "Shopify CSV",
  // Google Merchant Center RSS feed (products; other sheets fall back to XML).
  google_feed: "Google Shopping Feed",
};


/**
 * Entities grouped by the part of the store they belong to — the sheet
 * table renders one labelled band per group. Anything missing from here
 * still shows up: leftovers land under "Other" rather than being hidden.
 */
const ENTITY_GROUPS = [
  { label: "Catalog", entities: ["products", "product_media", "collections", "smart_collections", "custom_collections", "inventory", "inventory_transfers", "selling_plans"] },
  { label: "Sales", entities: ["orders", "draft_orders", "discounts", "gift_cards", "payouts"] },
  { label: "Customers", entities: ["customers", "segments", "companies", "store_credit"] },
  { label: "Content", entities: ["content", "articles", "files", "menus", "redirects", "translations"] },
  { label: "Store setup", entities: ["shop", "locations", "markets", "delivery_profiles", "catalogs", "metafields", "metaobjects", "definitions", "activity"] },
];

/**
 * Rough export throughput, records per second, used for the pre-run time
 * estimate. Heavy entities page few records per API call because of their
 * sub-selections (variants, line items, media); light ones page 250.
 */
const SLOW_ENTITIES = new Set([
  "products", "orders", "draft_orders", "subscriptions", "translations",
  "inventory", "product_media", "companies", "metaobjects",
]);

function estimateSeconds(entities, counts) {
  let seconds = 2; // job setup + format + upload
  for (const e of entities) {
    const n = Number(counts?.[e]);
    if (!Number.isFinite(n)) { seconds += 3; continue; } // unknown count
    seconds += n / (SLOW_ENTITIES.has(e) ? 25 : 200);
  }
  return Math.max(2, Math.round(seconds));
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

// Conditions for the dynamic filter builder. Order matters — the first is
// the default for a new row. The two "empty" operators take no value.
const FILTER_OPERATORS = [
  { value: "equals_any", label: "equals to any of" },
  { value: "contains_any", label: "contains any of" },
  { value: "contains_none", label: "contains none of" },
  { value: "not_equal_any", label: "not equal to any of" },
  { value: "starts_with_any", label: "starts with any of" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];
const VALUELESS_OPERATORS = new Set(["is_empty", "is_not_empty"]);

// Built-in presets, always shown above the user's saved exports.
const PRESET_BUILTIN = ["Latest Export", "New Export"];



export default function ExportPage() {
  const loaderData = useLoaderData();
  const dataFetcher = useFetcher(); // lazily fetches the heavy counts + dynamic columns
  const presetFetcher = useFetcher(); // persists saved presets
  const schedFetcher = useFetcher(); // deferred "Schedule on" creation
  const stateFetcher = useFetcher(); // remembers the page between visits

  // The page shell renders immediately; kick off the counts fetch on mount so
  // they populate a moment later (instead of blocking the page from opening).
  useEffect(() => {
    if (!loaderData.ready) dataFetcher.load("/app/export?data=1");
    // Preload the job page's code chunk — Export navigates there the moment
    // the job id returns, and the chunk shouldn't be part of that wait.
    import("./app.run.$id.jsx").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deferred "Schedule on" created → hand over to the Schedules page.
  useEffect(() => {
    if (schedFetcher.data?.scheduled && schedFetcher.state === "idle") navigate("/app/scheduler");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedFetcher.data, schedFetcher.state]);

  // Back from a run page: the run's full configuration rides in history
  // state, so the page reopens exactly as it was submitted — entities,
  // columns, filters, sorting, format, and the advanced options.
  const location = useLocation();
  useEffect(() => {
    const r = location.state?.restore;
    if (!r) return;
    if (r.format) setFormat(r.format);
    setEntityState(stateFromSpec(r.specs ?? []));
    const o = r.options ?? {};
    applyAdvancedOptions(o);
    setPreset("Latest Export");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = dataFetcher.data?.counts ?? loaderData.counts;
  const lastExports = dataFetcher.data?.lastExports ?? loaderData.lastExports ?? {};
  const productDynamic = dataFetcher.data?.productDynamic ?? loaderData.productDynamic;
  const countsLoading = !loaderData.ready && !dataFetcher.data;

  // Dynamic product groups (inventory, metafields, variant metafields,
  // catalog pricing), derived from store data. Empty groups are omitted.
  const productDynamicGroups = useMemo(
    () => buildProductDynamicGroups(productDynamic ?? EMPTY_PRODUCT_DYNAMIC),
    [productDynamic],
  );
  const dynGroupsFor = (entity) => (entity === "products" ? productDynamicGroups : EMPTY_DYN_GROUPS);

  // The page as it was left (a hidden "__last_state" preset). Seeded into
  // the initial state rather than applied afterwards, so the defaults never
  // flash before the restore.
  const remembered = loaderData.lastState ?? null;
  const [format, setFormat] = useState(remembered?.format ?? loaderData.defaultFormat ?? "excel");
  // Advanced options card (collapsed by default).
  const [advOpen, setAdvOpen] = useState(false);
  const [advFilename, setAdvFilename] = useState("");
  const [advFilenameSource, setAdvFilenameSource] = useState("started");
  // Inline scheduling (Matrixify-style): "Schedule on" defers the run to a
  // date/time in the shop's timezone; "Repeat every" makes it an interval
  // schedule with an optional run limit. One-shot — not saved in presets.
  const [schedOnEnabled, setSchedOnEnabled] = useState(false);
  const [schedOnDate, setSchedOnDate] = useState("");
  const [schedOnHour, setSchedOnHour] = useState("00");
  const [schedOnMinute, setSchedOnMinute] = useState("00");
  const [schedOnTz, setSchedOnTz] = useState(loaderData.timezone || "UTC");
  // The shop's real IANA timezone rides in with the heavy ?data=1 payload;
  // adopt it automatically unless the user has already picked a zone.
  const tzTouched = useRef(false);
  const shopTimezone = dataFetcher.data?.shopTimezone ?? loaderData.shopTimezone ?? null;
  useEffect(() => {
    if (shopTimezone && !tzTouched.current) setSchedOnTz(shopTimezone);
  }, [shopTimezone]);
  // Every IANA zone the browser knows; the shop's display timezone leads.
  const tzOptions = useMemo(() => {
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { /* older browsers */ }
    if (!zones.length) zones = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Baku", "Asia/Tokyo", "Australia/Sydney"];
    const shopTz = loaderData.timezone || "UTC";
    if (!zones.includes(shopTz)) zones = [shopTz, ...zones];
    return zones.map((z) => ({ value: z, label: z }));
  }, [loaderData.timezone]);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatCount, setRepeatCount] = useState("1");
  const [repeatUnit, setRepeatUnit] = useState("days");
  const [repeatTimes, setRepeatTimes] = useState("until");
  const repeats = schedOnEnabled && repeatEnabled;
  const [advSkipEmpty, setAdvSkipEmpty] = useState(false);
  const [advZip, setAdvZip] = useState(false);
  const [advEmailTo, setAdvEmailTo] = useState("");
  // Post-run delivery — the run page's "Deliver to" picker, chosen up-front:
  // "" = ad-hoc URL mode (no delivery while the URL stays empty).
  const [advDeliverTarget, setAdvDeliverTarget] = useState("");
  const [advDeliverUrl, setAdvDeliverUrl] = useState("");
  // What the user last TYPED in URL mode — picking a saved server overwrites
  // the field with the server's URL, so switching back restores this.
  const typedDeliverUrl = useRef("");
  const [addingServer, setAddingServer] = useState(false);
  const [deliverTriggerRef, deliverTriggerWidth] = useElementWidth();
  const savedServers = loaderData.servers ?? [];
  // Formatting (Matrixify parity): date rendering + the Excel-safety apostrophe
  // (a select of WHICH values get prefixed, like Matrixify's).
  const [advExcelDates, setAdvExcelDates] = useState(false);
  const [advDateFormat, setAdvDateFormat] = useState("");
  const [advApostrophe, setAdvApostrophe] = useState("");
  // CSV dialect (Matrixify parity) — shown only while the CSV format is picked.
  // Both selects hold TOKENS ("comma", "double", …), not the literal
  // characters — a literal " or tab as an s-option value breaks the web
  // component's value matching, leaving the select with nothing selected.
  const [advCsvDelimiter, setAdvCsvDelimiter] = useState("comma");
  const [advCsvDelimiterCustom, setAdvCsvDelimiterCustom] = useState("");
  const [advCsvQuote, setAdvCsvQuote] = useState("double");
  const [advCsvQuoteCustom, setAdvCsvQuoteCustom] = useState("");
  const [advCsvNewline, setAdvCsvNewline] = useState("crlf");
  const [advCsvNewlineCustom, setAdvCsvNewlineCustom] = useState("");
  const [advCsvForceQuotes, setAdvCsvForceQuotes] = useState(false);
  const [advCsvBom, setAdvCsvBom] = useState(false);
  const [advCsvEncoding, setAdvCsvEncoding] = useState("utf8");
  // Sheet table sort: null col = the curated ENTITIES order.
  const [sheetSort, setSheetSort] = useState({ col: null, dir: 1 });
  const [sheetSearch, setSheetSearch] = useState("");

  // Google Shopping Feed is a products-only format (Altera behaves the same):
  // picking it selects Products and locks every other row; switching to any
  // other format restores whatever was selected before.
  const feedLock = format === "google_feed";
  const preFeedSelection = useRef(null);
  useEffect(() => {
    if (format === "google_feed") {
      setEntityState((prev) => {
        preFeedSelection.current = Object.keys(prev).filter((e) => prev[e].enabled);
        const next = {};
        for (const [e, s] of Object.entries(prev)) next[e] = { ...s, enabled: e === "products" };
        return next;
      });
    } else if (preFeedSelection.current) {
      const restore = new Set(preFeedSelection.current);
      preFeedSelection.current = null;
      setEntityState((prev) => {
        const next = {};
        for (const [e, s] of Object.entries(prev)) next[e] = { ...s, enabled: restore.has(e) };
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);
  // Anchor row for shift-click range selection, kept as a slug so a re-sort
  // between the two clicks can't silently shift the range.
  const lastPickedSheet = useRef(null);

  // Preset state. "Latest Export" and "New Export" are built-in presets;
  // savedPresets holds user-saved configurations. presetName backs the
  // save modal's input; lastConfig captures the most recent export so
  // "Latest Export" can restore it.
  const [preset, setPreset] = useState(remembered?.preset ?? "New Export");
  // Which template is on the page, if any — kept by id so a saved preset of
  // the same name is still a different thing.
  const [templateId, setTemplateId] = useState(remembered?.templateId ?? "");
  const [savedPresets, setSavedPresets] = useState(() => loaderData.presets ?? []);
  const [presetName, setPresetName] = useState("");
  const [lastConfig, setLastConfig] = useState(null);
  // Row actions inside the picker: which preset is being renamed (and the
  // text being typed), and which one is waiting for its delete to be
  // confirmed. Both are ids, so a rename can't follow the wrong row.
  const [renamingId, setRenamingId] = useState("");
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  // The page as the picked preset left it. Everything the preset would save
  // is snapshotted here when one is applied (or saved); comparing the same
  // snapshot after each change is what decides the star / Update.
  // Restoring the baseline restores the star too: it is the same comparison,
  // so a page left mid-edit reopens still showing it.
  const [baseline, setBaseline] = useState(remembered?.baseline ?? null);
  // Set to re-take the baseline on the next paint — after applying a preset
  // the new configuration only exists once React has re-rendered.
  const rebaseline = useRef(!remembered?.baseline);

  // Per-entity state: { enabled, filters: {key→value}, selectedFields: string[] }
  const [entityState, setEntityState] = useState(() => (remembered?.entityState
    ? normalizeStateSorts(remembered.entityState)
    : initialEntityState()));

  // Opened via Duplicate (?duplicate=<jobId>): load that run's configuration
  // once, ready to tweak — nothing starts until Export is clicked.
  const dupApplied = useRef(false);
  useEffect(() => {
    const dup = loaderData.duplicateExport;
    if (!dup || dupApplied.current) return;
    dupApplied.current = true;
    setFormat(dup.format);
    setEntityState(normalizeStateSorts(stateFromSpec(dup.spec)));
    applyAdvancedOptions(dup.options ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData.duplicateExport]);

  // Sheet Permissions (Settings): entities blocked there are hidden here and
  // can't be exported. `visibleEntities` drives both the cards and the specs.
  const visibleEntities = ENTITIES.filter((e) => !isEntityBlocked(e, loaderData.blockedEntities));
  const enabledEntities = visibleEntities.filter((e) => entityState[e].enabled);

  // Sheet table rows: filtered by the search box (name or slug), grouped by
  // domain, then resorted WITHIN each group on header click. Records and
  // Last-export default to descending (biggest / most recent first); a second
  // click flips it — ascending Last-export answers "what haven't I backed up
  // lately?".
  const sortSheets = (col) =>
    setSheetSort((p) => (p.col === col ? { col, dir: -p.dir } : { col, dir: col === "name" ? 1 : -1 }));
  const sheetGroups = (() => {
    const q = sheetSearch.trim().toLowerCase();
    const matches = (e) => !q || entityDisplayName(e).toLowerCase().includes(q) || e.includes(q);
    const inGroups = new Set(ENTITY_GROUPS.flatMap((g) => g.entities));
    const groups = ENTITY_GROUPS.map((g) => ({
      label: g.label,
      items: g.entities.filter((e) => visibleEntities.includes(e) && matches(e)),
    }));
    const leftovers = visibleEntities.filter((e) => !inGroups.has(e) && matches(e));
    if (leftovers.length) groups.push({ label: "Other", items: leftovers });
    const { col, dir } = sheetSort;
    if (col) {
      const t = (e) => (lastExports[e] ? Date.parse(lastExports[e]) : 0);
      const cmp = {
        name: (a, b) => entityDisplayName(a).localeCompare(entityDisplayName(b)) * dir,
        records: (a, b) => ((counts?.[a] ?? -1) - (counts?.[b] ?? -1)) * dir,
        last: (a, b) => (t(a) - t(b)) * dir,
      }[col];
      for (const g of groups) g.items.sort(cmp);
    }
    return groups.filter((g) => g.items.length > 0);
  })();
  // Flat list in display order — shift-click ranges span group boundaries.
  const sortedSheetEntities = sheetGroups.flatMap((g) => g.items);

  // Row toggle. Shift-click applies the clicked row's new state to every row
  // between it and the last one you picked, in the order currently displayed.
  const toggleSheetRow = (entity, shift) => {
    if (feedLock && entity !== "products") return;
    const next = !entityState[entity].enabled;
    const anchor = lastPickedSheet.current;
    const to = sortedSheetEntities.indexOf(entity);
    const from = anchor ? sortedSheetEntities.indexOf(anchor) : -1;
    if (shift && from !== -1 && to !== -1 && from !== to) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const range = sortedSheetEntities.slice(lo, hi + 1);
      setEntityState((prev) => {
        const copy = { ...prev };
        for (const e of range) {
          if (feedLock && e !== "products") continue; // feed keeps others locked
          copy[e] = { ...copy[e], enabled: next };
        }
        return copy;
      });
    } else {
      setEntityEnabled(entity, next);
    }
    lastPickedSheet.current = entity;
  };

  function setEntityEnabled(key, value) {
    setEntityState((prev) => ({ ...prev, [key]: { ...prev[key], enabled: value } }));
  }
  // Dynamic filter rows: each entity holds an ordered list of
  // { id, column, operator, value }. Add appends a blank row defaulted to
  // the entity's first column; update patches one row; remove drops it.
  function addEntityFilterRow(key) {
    const cols = FIELDS_BY_ENTITY[key] ?? PRODUCT_FIELDS;
    setEntityState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        advancedFilters: [
          ...prev[key].advancedFilters,
          { id: crypto.randomUUID(), column: cols[0], operator: FILTER_OPERATORS[0].value, value: "" },
        ],
      },
    }));
  }
  function updateEntityFilterRow(key, id, patch) {
    setEntityState((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        advancedFilters: prev[key].advancedFilters.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
    }));
  }
  function removeEntityFilterRow(key, id) {
    setEntityState((prev) => ({
      ...prev,
      [key]: { ...prev[key], advancedFilters: prev[key].advancedFilters.filter((r) => r.id !== id) },
    }));
  }
  function toggleEntityField(key, field) {
    setEntityState((prev) => {
      const cur = prev[key].selectedFields;
      const next = cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field];
      return { ...prev, [key]: { ...prev[key], selectedFields: next } };
    });
  }
  function setEntityFields(key, fields) {
    setEntityState((prev) => ({ ...prev, [key]: { ...prev[key], selectedFields: fields } }));
  }
  function addEntitySort(key) {
    setEntityState((prev) => ({
      ...prev,
      [key]: { ...prev[key], sort: [...prev[key].sort, { id: crypto.randomUUID(), column: "", direction: "asc" }] },
    }));
  }
  function updateEntitySort(key, id, patch) {
    setEntityState((prev) => ({
      ...prev,
      [key]: { ...prev[key], sort: prev[key].sort.map((r) => (r.id === id ? { ...r, ...patch } : r)) },
    }));
  }
  function removeEntitySort(key, id) {
    setEntityState((prev) => ({
      ...prev,
      [key]: { ...prev[key], sort: prev[key].sort.filter((r) => r.id !== id) },
    }));
  }

  // Each popover matches the width of its full-width trigger (s-popover has
  // no "match trigger" option), so we measure the trigger and feed its pixel
  // width into the popover's inlineSize.
  const [formatTriggerRef, formatTriggerWidth] = useElementWidth();
  const [presetTriggerRef, presetTriggerWidth] = useElementWidth();

  // Export never submits from this page any more — handleExport navigates to
  // the run's page instantly and THAT page starts the job. `leaving` drives
  // the button's spinner for the brief route transition.
  const [leaving, setLeaving] = useState(false);
  const isExporting = leaving;
  const navigate = useNavigate();

  // Apply a preset: built-ins reset or restore the last export; a saved
  // preset restores its stored format + entity configuration.
  /**
   * Put a built-in template on the page. Applied exactly like a preset — it
   * just can't be renamed, changed or deleted, and saving keeps it as a
   * preset of the merchant's own rather than writing back into the template.
   */
  function applyTemplate(t) {
    setPreset(t.name);
    setTemplateId(t.id);
    rebaseline.current = true;
    setRenamingId("");
    setConfirmDeleteId("");
    setFormat(t.format);
    setEntityState(normalizeStateSorts(stateFromSpec(t.specs)));
    applyAdvancedOptions(t.options ?? {});
  }

  function applyPreset(name) {
    setPreset(name);
    setTemplateId("");
    // The applied configuration only exists after the next render, so the
    // baseline is taken there rather than from the values written here.
    rebaseline.current = true;
    setRenamingId("");
    setConfirmDeleteId("");
    if (name === "New Export") {
      // "No preset" is the page as it is first drawn — the advanced options
      // reset too, or a setting from the previous preset would survive it.
      setEntityState(initialEntityState());
      setFormat(loaderData.defaultFormat ?? "excel");
      applyAdvancedOptions({});
    } else if (name === "Latest Export") {
      // In-session copy first (it has the freshest UI state); otherwise
      // rebuild from the last run's stored spec, so this works after reload.
      if (lastConfig) {
        setFormat(lastConfig.format);
        setEntityState(lastConfig.entityState);
      } else if (loaderData.latestExport) {
        setFormat(loaderData.latestExport.format);
        setEntityState(stateFromSpec(loaderData.latestExport.spec));
      }
    } else {
      const p = savedPresets.find((s) => s.name === name);
      if (p) {
        setFormat(p.format);
        setEntityState(normalizeStateSorts(p.entityState));
        // Full restore — a preset without stored options resets to defaults.
        applyAdvancedOptions(p.options ?? {});
      }
    }
  }

  // Build one spec per enabled entity (filters + column selection). Shared by
  // Export and Save-preset so a preset captures exactly what an export would run.
  function buildSpecs() {
    return enabledEntities.map((e) => {
      const s = entityState[e];
      const all = allFieldsFor(e, dynGroupsFor(e));
      const defs = FILTERS_BY_ENTITY[e] ?? [];

      const filters = {};
      for (const def of defs) {
        const value = s.filters[def.key];
        if (value) filters[def.key] = value;
      }

      // Products always send an explicit list: the "all selected → undefined"
      // shortcut would make the backend fall back to the static field list and
      // drop the dynamic inventory columns.
      const fields = e !== "products" && s.selectedFields.length === all.length
        ? undefined
        : s.selectedFields;

      const advancedFilters = (s.advancedFilters ?? [])
        .filter((r) => r.column && r.operator &&
          (VALUELESS_OPERATORS.has(r.operator) || r.value.trim() !== ""))
        .map((r) => ({ column: r.column, operator: r.operator, value: r.value.trim() }));

      // Multi-field sort: rules apply in order, first one wins ties last.
      const sortRules = (s.sort ?? [])
        .filter((r) => r.column)
        .map((r) => ({ column: r.column, direction: r.direction === "desc" ? "desc" : "asc" }));
      const sort = sortRules.length > 0 ? sortRules : undefined;

      return { entity: e, filters, fields, advancedFilters, sort };
    });
  }

  // What a preset would save, as one comparable string. The ad-hoc delivery
  // URL is left out because a preset never stores it — otherwise typing one
  // would show a change that saving could not capture.
  function presetSignature() {
    const options = buildAdvancedOptions();
    delete options.deliverUrl;
    return stableJson({ format, spec: buildSpecs(), options });
  }
  const currentSignature = presetSignature();
  const pickedSaved = savedPresets.find((p) => p.name === preset) ?? null;
  const dirty = baseline !== null && currentSignature !== baseline;
  // Which single button to show — the rule lives in presetButton.js so it can
  // be read (and tested) as a table rather than inferred from the markup.
  const presetAction = presetButton({
    picked: templateId ? "template"
      : pickedSaved ? "saved"
      : preset === "Latest Export" ? "latest"
      : "none",
    dirty,
  });

  // Take the baseline once the applied configuration is actually on the page
  // (and once on first paint, so an untouched page counts as unchanged).
  // No dependency list on purpose: the ref is the guard (one baseline per
  // request), and depending on the signature would re-baseline after every
  // edit — which is exactly what must NOT happen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rebaseline.current) return;
    rebaseline.current = false;
    setBaseline(currentSignature);
  });

  // The Advanced options live in ~20 separate fields, so they are written
  // once on mount rather than seeded one by one — in a layout effect, which
  // runs before the browser paints, so nothing shows the defaults first.
  useLayoutEffect(() => {
    if (remembered?.options) applyAdvancedOptions(remembered.options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember the page, one write after the changes stop. The baseline rides
  // along so the star is still there after a reload; the delivery URL never
  // does, for the same reason a preset doesn't keep it.
  const rememberedPayload = useRef(null);
  useEffect(() => {
    const options = buildAdvancedOptions();
    delete options.deliverUrl;
    const payload = JSON.stringify({ preset, templateId, format, entityState, options, baseline });
    if (rememberedPayload.current === null) { rememberedPayload.current = payload; return undefined; }
    if (rememberedPayload.current === payload) return undefined;
    const t = setTimeout(() => {
      rememberedPayload.current = payload;
      stateFetcher.submit({ intent: "savePageState", state: payload }, { method: "post" });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, templateId, format, entityState, currentSignature, baseline]);

  // A duplicate's name is invented by the server (Name (2), (3) …), so the
  // list takes it from the reply rather than guessing it here.
  useEffect(() => {
    const d = presetFetcher.data;
    if (!d?.preset || presetFetcher.state !== "idle") return;
    setSavedPresets((prev) => (prev.some((x) => x.id === d.preset.id)
      ? prev.map((x) => (x.id === d.preset.id ? { ...x, ...d.preset } : x))
      : [d.preset, ...prev]));
  }, [presetFetcher.data, presetFetcher.state]);

  // Save the current configuration as a named preset — persisted server-side so
  // it survives reloads and can be picked by a Schedule.
  function savePreset(overrideName) {
    // Only a real string counts as an override: handed a click event (an easy
    // mistake from an onClick), fall back to the name typed in the dialog.
    const name = (typeof overrideName === "string" ? overrideName : presetName).trim();
    if (!name) return;
    const spec = buildSpecs();
    // Ad-hoc URL credentials must never persist — presets keep the rest.
    const options = buildAdvancedOptions();
    delete options.deliverUrl;
    presetFetcher.submit(
      {
        intent: "savePreset", name, format,
        spec: JSON.stringify(spec),
        state: JSON.stringify(entityState),
        options: JSON.stringify(options),
      },
      { method: "post" },
    );
    setSavedPresets((prev) => [...prev.filter((p) => p.name !== name), {
      ...(prev.find((p) => p.name === name) ?? {}),
      name, format, entityState, spec, options,
    }]);
    setPreset(name);
    setTemplateId(""); // saved under a name of its own, it is a preset now
    setPresetName("");
    // Just saved: what is on the page IS the preset now.
    setBaseline(currentSignature);
  }

  // Row actions in the picker. Each goes to the server and mirrors the result
  // locally so the list doesn't wait for a reload.
  function renamePreset(p) {
    const name = renameText.trim();
    setRenamingId("");
    if (!name || name === p.name) return;
    presetFetcher.submit({ intent: "renamePreset", id: p.id, name }, { method: "post" });
    setSavedPresets((prev) => prev.map((x) => (x.id === p.id ? { ...x, name } : x)));
    if (preset === p.name) setPreset(name);
  }
  function duplicatePreset(p) {
    presetFetcher.submit({ intent: "duplicatePreset", id: p.id }, { method: "post" });
  }
  function deletePreset(p) {
    setConfirmDeleteId("");
    presetFetcher.submit({ intent: "deletePreset", id: p.id }, { method: "post" });
    setSavedPresets((prev) => prev.filter((x) => x.id !== p.id));
    // The page keeps what it shows, but it is no longer "that preset": the
    // baseline is taken again so nothing offers to update a deleted preset.
    if (preset === p.name) {
      setPreset("New Export");
      rebaseline.current = true;
    }
  }

  // The Advanced-section options as one object — the shape jobs store and
  // presets capture. Built for exports and preset saves alike.
  function buildAdvancedOptions() {
    return {
      filename: advFilename.trim() || null,
      filenameTimeSource: advFilenameSource === "finished" ? "finished" : null,
      skipEmpty: advSkipEmpty,
      zip: advZip,
      emailTo: advEmailTo.trim() || null,
      deliverTarget: advDeliverTarget || null,
      // Ad-hoc URL (credentials ride in it) only without a saved server; with
      // one, just the typed folder rides along — the password stays stored.
      deliverUrl: !advDeliverTarget && advDeliverUrl.trim() ? advDeliverUrl.trim() : null,
      deliverPath: advDeliverTarget
        ? (() => { try { return new URL(advDeliverUrl).pathname; } catch { return null; } })()
        : null,
      excelDates: advExcelDates,
      dateFormat: advDateFormat || null,
      apostrophe: advApostrophe || null,
      csv: format === "csv" ? {
        delimiter: advCsvDelimiter === "custom"
          ? (advCsvDelimiterCustom.trim().charAt(0) || ",")
          : (CSV_DELIMITERS[advCsvDelimiter] ?? ","),
        quote: advCsvQuote === "custom"
          ? (advCsvQuoteCustom.trim().charAt(0) || '"')
          : (CSV_QUOTES[advCsvQuote] ?? '"'),
        newline: advCsvNewline === "custom"
          ? (unescapeNewline(advCsvNewlineCustom) || "\r\n")
          : (CSV_NEWLINES[advCsvNewline] ?? "\r\n"),
        forceQuotes: advCsvForceQuotes,
        bom: advCsvBom,
        encoding: advCsvEncoding,
      } : null,
    };
  }

  // Push a stored options object back into the form — missing keys reset to
  // their defaults, so applying a preset is a COMPLETE restore.
  function applyAdvancedOptions(o = {}) {
    setAdvFilename(o.filename ?? "");
    setAdvFilenameSource(o.filenameTimeSource === "finished" ? "finished" : "started");
    setAdvZip(Boolean(o.zip));
    setAdvSkipEmpty(Boolean(o.skipEmpty));
    setAdvEmailTo(o.emailTo ?? "");
    setAdvDeliverTarget(o.deliverTarget ?? "");
    setAdvDeliverUrl(o.deliverUrl ?? "");
    setAdvExcelDates(Boolean(o.excelDates));
    setAdvDateFormat(o.dateFormat ?? "");
    setAdvApostrophe(o.apostrophe === true ? "all" : (o.apostrophe || ""));
    const c = o.csv ?? {};
    const d = c.delimiter || ",";
    const delimToken = Object.keys(CSV_DELIMITERS).find((k) => CSV_DELIMITERS[k] === d);
    if (delimToken) { setAdvCsvDelimiter(delimToken); setAdvCsvDelimiterCustom(""); }
    else { setAdvCsvDelimiter("custom"); setAdvCsvDelimiterCustom(d); }
    const q = c.quote || '"';
    const quoteToken = Object.keys(CSV_QUOTES).find((k) => CSV_QUOTES[k] === q);
    if (quoteToken) { setAdvCsvQuote(quoteToken); setAdvCsvQuoteCustom(""); }
    else { setAdvCsvQuote("custom"); setAdvCsvQuoteCustom(q); }
    const nl = c.newline || "\r\n";
    const nlToken = Object.keys(CSV_NEWLINES).find((k) => CSV_NEWLINES[k] === nl);
    if (nlToken) { setAdvCsvNewline(nlToken); setAdvCsvNewlineCustom(""); }
    else { setAdvCsvNewline("custom"); setAdvCsvNewlineCustom(escapeNewline(nl)); }
    setAdvCsvForceQuotes(Boolean(c.forceQuotes));
    setAdvCsvBom(Boolean(c.bom));
    setAdvCsvEncoding(c.encoding || "utf8");
  }

  function handleExport() {
    // "Schedule on" DEFERS the run: no job now — create the schedule (with
    // the repeat, if set) and let the Schedules page take it from there.
    // A missing date comes back as a validation error from the action.
    if (schedOnEnabled) {
      // Ad-hoc URL credentials must never persist on a schedule row.
      const schedOptions = buildAdvancedOptions();
      delete schedOptions.deliverUrl;
      schedFetcher.submit({
        intent: "createInlineSchedule",
        payload: JSON.stringify({
          format,
          specs: buildSpecs(),
          options: schedOptions,
          schedule: {
            date: schedOnDate.trim(),
            hour: parseInt(schedOnHour, 10) || 0,
            minute: parseInt(schedOnMinute, 10) || 0,
            tz: schedOnTz,
            interval: repeats
              ? { count: parseInt(repeatCount, 10) || 1, unit: repeatUnit }
              : null,
            maxRuns: repeats
              ? (repeatTimes === "until" ? null : parseInt(repeatTimes, 10) || 1)
              : 1,
          },
        }),
      }, { method: "post" });
      return;
    }
    setLeaving(true); // spinner on the button for the route transition
    setLastConfig({ format, entityState });

    // INSTANT: jump straight to the run's page with a client-generated id.
    // The payload rides in history state; the job page creates the job from
    // there — this page never waits on the server.
    const jobId = crypto.randomUUID();
    navigate(`/app/run/${jobId}`, {
      state: {
        start: {
          format,
          specs: buildSpecs(),
          options: buildAdvancedOptions(),
          // Recorded on the run so Activity can say what it was made with.
          presetName: preset,
          // Scheduling lives entirely behind the "Run on a schedule" switch,
          // which defers via createInlineSchedule — plain exports carry none.
          schedule: null,
        },
      },
    });
  }

  // Allow export when at least one entity is ticked and each ticked entity
  // still has at least one column selected.
  const canSubmit =
    enabledEntities.length > 0 &&
    enabledEntities.every((e) => entityState[e].selectedFields.length > 0) &&
    !isExporting;

  return (
    <s-page heading="Export">
      {/* Breadcrumb back to the home page → renders "SyncifyPro > Export" in the title bar. */}
      <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>
      {/* Title-bar actions (top-right): primary Export mirrors the form's Export
          button; tertiary Back returns to the home page. */}
      <s-button
        slot="primary-action"
        variant="primary"
        icon="download"
        onClick={handleExport}
        disabled={!canSubmit ? true : undefined}
        loading={isExporting ? true : undefined}
      >
        Export
      </s-button>
      <s-button slot="secondary-actions" variant="tertiary" icon="arrow-left" href="/app">Back</s-button>
      {/* Hover highlight for column groups and their column rows. */}
      <style>{`
        .eg-row, .eg-col { transition: background-color .1s ease; }
        .eg-row:hover, .eg-col:hover { background: #f6f6f7; }
        /* Sheet table: sticky header inside the scrollable wrapper; rows are
           toggles — selected ones tinted, unselected ones grey on hover. */
        .sheet-table thead th { position: sticky; top: 0; background: #ffffff; box-shadow: 0 1px 0 #e3e5e7; z-index: 1; }
        /* Column-order rows: native buttons (focusable, Alt+arrow operable),
           dragged by the handle only, vertical-only. Non-dragged rows slide
           between slots on a transform transition — the smooth Reportify-
           style reorder; the held row moves with the pointer untransitioned. */
        .col-order-row { display: flex; align-items: center; gap: .5rem; width: 100%; text-align: left; border: 1px solid #e3e5e7; border-radius: 8px; background: #ffffff; padding: .3rem .5rem; font: inherit; font-size: .8125rem; color: #303030; transition: transform .15s ease; user-select: none; cursor: grab; touch-action: none; }
        .col-order-row:hover { background: #fafbfb; }
        .col-order-row:active { cursor: grabbing; }
        .col-order-row.dragging { background: #ffffff; }
        .col-order-row[disabled] { opacity: .6; cursor: default; }
        .col-drag-handle { display: inline-flex; align-items: center; color: #8a9199; }
        /* Advanced-options header: plain toggle, no hover effect. It carries
           the card's padding so the whole collapsed card is clickable. */
        .adv-toggle { display: block; width: 100%; border: 0; padding: 1rem; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; }
        /* Slim scrollbar on the table wrapper — the default one is chunky
           next to the compact rows. Firefox via scrollbar-width, WebKit via
           the pseudo-elements. */
        .sheet-scroll { scrollbar-width: thin; scrollbar-color: #c9cccf transparent; }
        .sheet-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .sheet-scroll::-webkit-scrollbar-track { background: transparent; }
        .sheet-scroll::-webkit-scrollbar-thumb { background: #c9cccf; border-radius: 3px; }
        .sheet-scroll::-webkit-scrollbar-thumb:hover { background: #a6acb2; }
        /* Domain bands between the rows. */
        .sheet-group td { background: #fafbfb; border-top: 1px solid #e3e5e7; padding: .3rem .75rem; font-size: .6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #8a9199; }
        /* Native button so the header shrinks to its label and honours the
           cell's alignment — s-clickable's host is always full width. */
        .th-sort { display: inline-flex; align-items: center; gap: .25rem; border: 0; padding: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; }
        .th-sort:hover { color: #303030; }
        /* No text selection — shift-clicking a range would otherwise leave
           the rows highlighted by the browser. */
        .sheet-table tbody { user-select: none; }
        .sheet-tr { cursor: pointer; }
        /* No focus ring on rows at all — shift-click counts as "keyboard"
           in Chrome's :focus-visible heuristic, so even the scoped version
           flashed an outline. The tinted row is the selection feedback. */
        .sheet-tr:focus { outline: none; }
        .sheet-tr.on td { background: #f0f5fd; }
        .sheet-tr:not(.on):hover td { background: #f6f6f7; }
        /* Rows locked by a products-only format (Google Shopping Feed). */
        .sheet-tr.locked { cursor: default; }
        .sheet-tr.locked td { opacity: .45; }
        .sheet-tr.locked:hover td { background: transparent; }
        /* Sheets (main, 60%) beside Options (side, 40%). DOM order = visual
           order, so the layout is right even before any CSS-driven
           placement — no card-swap flash on load. */
        .export-cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
        @media (max-width: 860px) { .export-cols { grid-template-columns: 1fr; } }
        @keyframes eg-indeterminate { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
      `}</style>
      <s-stack direction="block" gap="base">

        {/* ── Sheets + Options ─────────────────────────────────────────
            Two columns: the entity table on the left, everything that shapes
            the whole run on the right. Written in that same order so the
            server-rendered HTML is already correct — no swap on load. */}
        <div className="export-cols">

        {/* ── Sheets ───────────────────────────────────────────────────
            Entity table: one sortable row per entity (records, last export,
            include toggle); each chosen sheet then appears below as a compact
            row with record total and time estimate, expandable for filters +
            column selection. */}
        <div className="export-main">
        <s-section>
          <s-stack direction="block" gap="base">
            <div style={sheetsHeader}>
              <span style={sheetsTitle}>Data</span>
              <s-text color="subdued">
                {feedLock
                  ? "Google Shopping Feed exports Products only"
                  : "Shift-click to select a range"}
              </s-text>
              <div style={{ minWidth: 200, flex: "0 1 240px" }}>
                <SharedTextField
                  label="Search entities"
                  labelAccessibilityVisibility="exclusive"
                  placeholder={`Search ${visibleEntities.length} entities…`}
                  value={sheetSearch}
                  onChange={setSheetSearch}
                />
              </div>
            </div>

            {/* Entity table: every entity is a row with its record count and
                when it was last exported — click a header to sort ("biggest
                first", "least recently backed up"). The whole row is the
                toggle; the checkbox at the end is the visual state. */}
            <div className="sheet-scroll" style={sheetTableWrap}>
              <table className="sheet-table" style={sheetTable}>
                <thead>
                  <tr>
                    {[
                      // Leading checkbox column — the tick speaks for itself,
                      // so the header stays blank.
                      { key: null, label: "", align: "center" },
                      { key: "name", label: "Data", align: "left" },
                      { key: "records", label: "Records", align: "right" },
                      { key: "last", label: "Last export", align: "left" },
                    ].map((col) => (
                      <th key={col.key ?? "include"} style={sheetTh}>
                        {/* Flex wrapper does the aligning — s-clickable is
                            block-level, so text-align on the cell can't move
                            it. Records lines up with its numbers. */}
                        <div style={{ display: "flex", justifyContent: TH_ALIGN[col.align] }}>
                          {col.key ? (
                            <button
                              type="button"
                              className="th-sort"
                              onClick={() => sortSheets(col.key)}
                              aria-label={`Sort by ${col.label}`}
                            >
                              {col.label}
                              {sheetSort.col === col.key && (
                                <s-icon type={sheetSort.dir === 1 ? "chevron-up" : "chevron-down"} />
                              )}
                            </button>
                          ) : col.label}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheetGroups.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ ...sheetTd, textAlign: "center", color: "#8a9199" }}>
                        No entity matches “{sheetSearch}”.
                      </td>
                    </tr>
                  )}
                  {sheetGroups.map((g) => (
                    <Fragment key={g.label}>
                      {/* Domain band — just the group's name. */}
                      <tr className="sheet-group">
                        <td colSpan={4}>{g.label}</td>
                      </tr>
                      {g.items.map((e) => {
                        const picked = entityState[e].enabled;
                        const rowFeedLocked = feedLock && e !== "products";
                        const locked = isExporting || rowFeedLocked;
                        return (
                      <tr
                        key={e}
                        className={`sheet-tr${picked ? " on" : ""}${rowFeedLocked ? " locked" : ""}`}
                        role="checkbox"
                        aria-checked={picked}
                        aria-disabled={rowFeedLocked || undefined}
                        aria-label={entityDisplayName(e)}
                        tabIndex={rowFeedLocked ? -1 : 0}
                        onClick={(ev) => { if (!locked) toggleSheetRow(e, ev.shiftKey); }}
                        onKeyDown={(ev) => {
                          if (ev.key === " " || ev.key === "Enter") {
                            ev.preventDefault();
                            if (!locked) toggleSheetRow(e, ev.shiftKey);
                          }
                        }}
                      >
                        <td style={{ ...sheetTd, textAlign: "center", width: 1 }}>
                          <span style={{ pointerEvents: "none", display: "inline-flex" }}>
                            <PolarisCheckbox
                              label={entityDisplayName(e)}
                              labelAccessibilityVisibility="exclusive"
                              checked={picked}
                              onChange={(v) => setEntityEnabled(e, v)}
                              disabled={locked}
                            />
                          </span>
                        </td>
                        <td style={sheetTd}>
                          <span style={sheetTdEntity}>
                            <span style={sheetPickIcon}>
                              {ENTITY_ICONS[e] && <s-icon type={ENTITY_ICONS[e]} />}
                            </span>
                            <span>{entityDisplayName(e)}</span>
                          </span>
                        </td>
                        <td style={{ ...sheetTd, textAlign: "right" }}>
                          {counts?.[e] != null
                            ? counts[e].toLocaleString()
                            : (countsLoading ? "…" : "—")}
                        </td>
                        <td style={{ ...sheetTd, color: "#616a75" }}>
                          {timeAgo(lastExports[e])}
                        </td>
                      </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {enabledEntities.length === 0 && (
              <s-banner tone="info">
                Tick one or more entities above — each gets its own filter and column options.
              </s-banner>
            )}
          </s-stack>
        </s-section>
        </div>

        {/* ── Options (right column) ──────────────────────────────────── */}
        <div className="export-side">
        <s-section>
          {/* Same markup as the Sheets title so both cards read alike —
              s-section's own `heading` renders lighter. */}
          <div style={sheetsHeader}>
            <span style={sheetsTitle}>Options</span>
          </div>

          {/* Preset: same trigger+popover pattern as Format, with a Save
              button beside it that stores the current configuration. */}
          <span style={optionLabel}>Preset</span>
          {/* Save sits UNDER the select so the trigger gets the full width. */}
          <div style={{ display: "flex", flexDirection: "column", gap: ".5rem", alignItems: "stretch" }}>
            <div ref={presetTriggerRef} style={{ minWidth: 0 }}>
              <s-clickable
                command="--toggle"
                commandFor="preset-popover"
                disabled={isExporting ? true : undefined}
                inlineSize="100%"
                borderWidth="base"
                borderStyle="solid"
                borderColor="strong"
                borderRadius="base"
                paddingInline="small-100"
                blockSize="32px"
                background="base"
              >
                <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                  <span>{preset}</span>
                  <s-icon type="select" />
                </s-grid>
              </s-clickable>
            </div>
            {/* One button at a time, and only when there is something to
                save: Update writes into the picked preset, Save as keeps the
                page under a new name. The star says the page no longer
                matches what was picked.
                inlineSize="fill" is the s-button way to go full-width
                ("100%" is not a valid value and falls back to auto). */}
            {presetAction === "update" && (
              <>
                <s-tooltip id="preset-update-tip">
                  The page differs from the saved preset
                </s-tooltip>
                <s-button
                  variant="secondary"
                  inlineSize="fill"
                  interestFor="preset-update-tip"
                  disabled={isExporting ? true : undefined}
                  onClick={() => savePreset(pickedSaved.name)}
                >
                  Update
                </s-button>
              </>
            )}
            {(presetAction === "saveAs" || presetAction === "saveAsStar") && (
              <>
                {dirty && (
                  <s-tooltip id="preset-saveas-tip">
                    The page differs from the selected preset
                  </s-tooltip>
                )}
                <s-button
                  variant="secondary"
                  inlineSize="fill"
                  {...(dirty ? { interestFor: "preset-saveas-tip" } : {})}
                  command="--show"
                  commandFor="save-preset-modal"
                  disabled={isExporting ? true : undefined}
                >
                  {dirty ? "Save as *" : "Save as"}
                </s-button>
              </>
            )}
          </div>
          {/* A template says what it is for — it is not a name the merchant chose. */}
          {templateId && (
            <s-text color="subdued">{templateById(templateId)?.description}</s-text>
          )}
          <s-popover id="preset-popover" {...widthProps(presetTriggerWidth)}>
            <s-box padding="small-200">
              <s-stack direction="block" gap="small-300">
                {PRESET_BUILTIN.map((name) => (
                  <PickerRow key={name} label={name} selected={preset === name} onSelect={() => applyPreset(name)} popoverId="preset-popover" />
                ))}
                <s-text color="subdued">Templates</s-text>
                {EXPORT_TEMPLATES.map((t) => (
                  <PickerRow
                    key={t.id}
                    label={t.name}
                    selected={templateId === t.id}
                    onSelect={() => applyTemplate(t)}
                    popoverId="preset-popover"
                  />
                ))}
                <s-text color="subdued">Saved</s-text>
                {savedPresets.length === 0 ? (
                  <s-text color="subdued">No saved exports yet.</s-text>
                ) : (
                  savedPresets.map((p) => (
                    <PresetRow
                      key={p.id ?? p.name}
                      preset={p}
                      selected={preset === p.name}
                      renaming={renamingId === (p.id ?? p.name)}
                      renameText={renameText}
                      confirmingDelete={confirmDeleteId === (p.id ?? p.name)}
                      onApply={() => applyPreset(p.name)}
                      onStartRename={() => { setRenamingId(p.id ?? p.name); setRenameText(p.name); setConfirmDeleteId(""); }}
                      onRenameText={setRenameText}
                      onRename={() => renamePreset(p)}
                      onCancelRename={() => setRenamingId("")}
                      onDuplicate={() => duplicatePreset(p)}
                      onAskDelete={() => { setConfirmDeleteId(p.id ?? p.name); setRenamingId(""); }}
                      onCancelDelete={() => setConfirmDeleteId("")}
                      onDelete={() => deletePreset(p)}
                    />
                  ))
                )}
              </s-stack>
            </s-box>
          </s-popover>

          {/* Save-configuration modal */}
          <s-modal id="save-preset-modal" heading="Save your changes as a preset">
            <PolarisTextField
              label="Preset name"
              value={presetName}
              onChange={setPresetName}
              placeholder="e.g. Weekly products"
            />
            {/* Wrapped: passing savePreset directly would hand it the click
                event, which it would take as the name to save under. */}
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={() => savePreset()}
              command="--hide"
              commandFor="save-preset-modal"
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" command="--hide" commandFor="save-preset-modal">
              Cancel
            </s-button>
          </s-modal>

          {/* Format: the trigger shows the current format and opens a popover
              where each format is a row that checkmarks when selected. */}
          <span style={optionLabel}>Format</span>
          {/* Block-level wrapper is naturally full width — measuring it gives
              the true rendered button width to mirror onto the popover. */}
          <div ref={formatTriggerRef} style={{ width: "100%" }}>
            <s-clickable
              command="--toggle"
              commandFor="format-popover"
              disabled={isExporting ? true : undefined}
              inlineSize="100%"
              borderWidth="base"
              borderStyle="solid"
              borderColor="strong"
              borderRadius="base"
              paddingInline="small-100"
              blockSize="32px"
              background="base"
            >
              <s-grid gridTemplateColumns="auto 1fr auto" gap="small" alignItems="center">
                <FormatIcon format={format} />
                <span>{FORMAT_LABELS[format] ?? format}</span>
                <s-icon type="select" />
              </s-grid>
            </s-clickable>
          </div>
          <s-popover id="format-popover" {...widthProps(formatTriggerWidth)}>
            <s-box padding="small-200">
              <s-stack direction="block" gap="small-300">
                {FORMATS.map((f) => (
                  <PickerRow
                    key={f}
                    label={FORMAT_LABELS[f] ?? f}
                    icon={<FormatIcon format={f} />}
                    selected={format === f}
                    onSelect={() => setFormat(f)}
                    popoverId="format-popover"
                  />
                ))}
              </s-stack>
            </s-box>
          </s-popover>

          {/* Custom file name; a fixed name (no placeholders) produces the
              same file on every run — the supplier-feed pattern. The hint
              follows the selection: one sheet → its name, several → Export. */}
          <span style={optionLabel}>File name</span>
          <div style={fieldHelpWrap}>
            <SharedTextField
              label="File name"
              labelAccessibilityVisibility="exclusive"
              placeholder={`${
                enabledEntities.length === 1
                  ? entityDisplayName(enabledEntities[0]).replace(/\s+/g, "_")
                  : "Export"
              }_{date}-{time}`}
              value={advFilename}
              onChange={setAdvFilename}
              disabled={isExporting}
            />
            <s-text color="subdued">
              Placeholders: {"{date}"}, {"{time}"}, {"{shop}"}.
            </s-text>
          </div>


        </s-section>
        </div>

        </div>

        {/* ── Sheets ──────────────────────────────────────────────────
            The selected entities, wrapped in one card: each gets its own
            sub-card with columns, filters and sorting. The picker table
            above is the "Data" card. */}
        {enabledEntities.length > 0 && (
          <s-section>
            <s-stack direction="block" gap="base">
              <div style={sheetsHeader}>
                <span style={sheetsTitle}>Sheets</span>
                <s-text color="subdued">
                  {enabledEntities.length} selected — each sheet has its own columns, filters and sorting
                </s-text>
              </div>
              {enabledEntities.map((e) => (
                <EntityConfigCard
                  key={e}
                  entity={e}
                  state={entityState[e]}
                  count={counts?.[e] ?? null}
                  dynGroups={dynGroupsFor(e)}
                  onAddFilter={() => addEntityFilterRow(e)}
                  onUpdateFilter={(id, patch) => updateEntityFilterRow(e, id, patch)}
                  onRemoveFilter={(id) => removeEntityFilterRow(e, id)}
                  onToggleField={(f) => toggleEntityField(e, f)}
                  onSetFields={(fields) => setEntityFields(e, fields)}
                  onAddSort={() => addEntitySort(e)}
                  onUpdateSort={(id, patch) => updateEntitySort(e, id, patch)}
                  onRemoveSort={(id) => removeEntitySort(e, id)}
                  onRemove={() => setEntityEnabled(e, false)}
                  disabled={isExporting}
                />
              ))}
            </s-stack>
          </s-section>
        )}


        {/* ── Advanced options ─────────────────────────────────────────
            Collapsed accordion mirroring Matrixify's Options card, adapted
            to this app: scheduling lives on the Schedules page, the file
            options run for real. A plain card div (not s-section) so the
            toggle button IS the whole collapsed card — no dead padding. */}
        <div style={advCard}>
          {/* Native button: keyboard-operable like s-clickable, but without
              its built-in hover tint. Carries the card padding itself, so
              every pixel of the collapsed card toggles it. */}
          <button
            type="button"
            className="adv-toggle"
            onClick={() => setAdvOpen((o) => !o)}
            aria-expanded={advOpen}
          >
            <div style={advHeader}>
              <span style={sheetsTitle}>Advanced</span>
              <s-icon type={advOpen ? "chevron-up" : "chevron-down"} />
            </div>
          </button>

          {advOpen && (
            <div style={advContent}>
            <s-stack direction="block" gap="base">

              {/* Scheduling — quick creation lives here, where the config
                  already is; management (destinations, history, pause) stays
                  on the Schedules page. */}
              <div style={advRow}>
                <span style={advRowLabel}>Scheduling</span>
                <div style={schedRowBody}>
                  {/* Polaris-native boxed layout: a switch, then labeled
                      fields in a two-column grid. */}
                  {/* The switch IS the "Run on" label; the fields below stay
                      visible and simply disable while it's off. */}
                  <PolarisSwitch
                    label="Run on"
                    checked={schedOnEnabled}
                    onChange={(on) => {
                      setSchedOnEnabled(on);
                      // A sensible first-run default the moment it's armed.
                      if (on && !schedOnDate) setSchedOnDate(new Date().toISOString().slice(0, 10));
                    }}
                  />
                      <div style={schedGrid}>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {/* No fixed width: the flex item hugs the field's
                                intrinsic width, so nothing clips or drifts. */}
                            <div style={{ flex: "none" }}>
                              <PolarisDateField
                                label="Run on date"
                                labelAccessibilityVisibility="exclusive"
                                value={schedOnDate}
                                onChange={setSchedOnDate}
                                // Past days can't host a future run.
                                allow={`${new Date().toISOString().slice(0, 10)}--`}
                                disabled={isExporting || !schedOnEnabled}
                              />
                            </div>
                            <span style={{ whiteSpace: "nowrap", flex: "none" }}>
                              <s-text color="subdued">, at</s-text>
                            </span>
                            {/* HH : MM as one tight unit with its own 3px gaps. */}
                            <div style={{ display: "flex", alignItems: "center", gap: 3, flex: "none" }}>
                              <div style={{ width: 66 }}>
                                <PolarisSelect
                                  label="Hour"
                                  labelAccessibilityVisibility="exclusive"
                                  value={schedOnHour}
                                  onChange={setSchedOnHour}
                                  options={HOURS_00_23}
                                  disabled={isExporting || !schedOnEnabled}
                                />
                              </div>
                              <s-text color="subdued">:</s-text>
                              <div style={{ width: 66 }}>
                                <PolarisSelect
                                  label="Minute"
                                  labelAccessibilityVisibility="exclusive"
                                  value={schedOnMinute}
                                  onChange={setSchedOnMinute}
                                  options={MINUTES_00_59}
                                  disabled={isExporting || !schedOnEnabled}
                                />
                              </div>
                            </div>
                            <div style={{ flex: 1, minWidth: 180, marginLeft: 8 }}>
                              <PolarisSelect
                                label="Timezone"
                                labelAccessibilityVisibility="exclusive"
                                value={schedOnTz}
                                onChange={(v) => { tzTouched.current = true; setSchedOnTz(v); }}
                                options={tzOptions}
                                disabled={isExporting || !schedOnEnabled}
                              />
                            </div>
                          </div>
                        </div>
                        <div style={{ ...fieldHelpWrap, gridColumn: "1 / -1" }}>
                          <PolarisCheckbox
                            label="Repeat every"
                            checked={repeatEnabled}
                            onChange={setRepeatEnabled}
                            disabled={isExporting || !schedOnEnabled}
                          />
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <div style={{ width: 76, flex: "none" }}>
                              <PolarisSelect
                                label="Repeat count"
                                labelAccessibilityVisibility="exclusive"
                                value={repeatCount}
                                onChange={setRepeatCount}
                                options={REPEAT_COUNTS}
                                disabled={isExporting || !repeats}
                              />
                            </div>
                            <div style={{ width: 120, flex: "none" }}>
                              <PolarisSelect
                                label="Repeat unit"
                                labelAccessibilityVisibility="exclusive"
                                value={repeatUnit}
                                onChange={setRepeatUnit}
                                options={REPEAT_UNITS}
                                disabled={isExporting || !repeats}
                              />
                            </div>
                            <div style={{ width: 170, flex: "none" }}>
                              <PolarisSelect
                                label="Stop after"
                                labelAccessibilityVisibility="exclusive"
                                value={repeatTimes}
                                onChange={setRepeatTimes}
                                options={STOP_AFTER}
                                disabled={isExporting || !repeats}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                  <s-text color="subdued">
                    The scheduled file is saved in the app — configure FTP, S3, email
                    or Google delivery on the Schedules page.
                  </s-text>
                  {schedFetcher.data?.error && (
                    <s-banner tone="critical">{schedFetcher.data.error}</s-banner>
                  )}
                  <div style={{ display: "flex" }}>
                    <s-button href="/app/scheduler">Open Schedules for more</s-button>
                  </div>
                </div>
              </div>

              <hr style={sectionRule} />

              {/* Export file — naming, splitting + packaging. */}
              <div style={advRow}>
                <span style={advRowLabel}>Export file</span>
                <div style={advRowBody}>
                  {/* Which timestamp fills {date}/{time} in the file name
                      (Matrixify parity). */}
                  <PolarisSelect
                    label="File name time source"
                    value={advFilenameSource}
                    onChange={setAdvFilenameSource}
                    options={[
                      { value: "started", label: "Started At (default)" },
                      { value: "finished", label: "Finished At" },
                    ]}
                    disabled={isExporting}
                  />
                  <PolarisCheckbox
                    label="Compress export file into a ZIP archive"
                    checked={advZip}
                    onChange={setAdvZip}
                    disabled={isExporting}
                  />
                  <PolarisCheckbox
                    label="Do not generate a file if there is no data"
                    checked={advSkipEmpty}
                    onChange={setAdvSkipEmpty}
                    disabled={isExporting}
                  />
                </div>
              </div>

              <hr style={sectionRule} />

              {/* Formatting — how cell values are written (Matrixify parity). */}
              <div style={advRow}>
                <span style={advRowLabel}>Formatting</span>
                <div style={advRowBody}>
                  <PolarisCheckbox
                    label="Format date columns as Excel date-time without timezone"
                    checked={advExcelDates}
                    onChange={setAdvExcelDates}
                    disabled={isExporting}
                  />
                  <div style={fieldHelpWrap}>
                    <PolarisSelect
                      label="Date-time format"
                      value={advDateFormat}
                      onChange={setAdvDateFormat}
                      options={DATE_FORMATS}
                      disabled={isExporting || advExcelDates}
                    />
                    <s-text color="subdued">
                      Applies to every exported date column. Times stay in UTC.
                    </s-text>
                  </div>
                  <div style={fieldHelpWrap}>
                    <PolarisSelect
                      label="Prefix values with ' (apostrophe)"
                      value={advApostrophe}
                      onChange={setAdvApostrophe}
                      options={APOSTROPHE_OPTIONS}
                      disabled={isExporting}
                    />
                    <s-text color="subdued">
                      The apostrophe keeps Excel and Google Sheets from converting the
                      value — leading zeros and long numbers stay as typed.
                    </s-text>
                  </div>
                </div>
              </div>

              {/* CSV dialect — only meaningful for the CSV format (Matrixify
                  shows the same sub-section when CSV is selected). */}
              {format === "csv" && (
                <>
                  <hr style={sectionRule} />
                  <div style={advRow}>
                    <span style={advRowLabel}>CSV</span>
                    <div style={advRowBody}>
                      <PolarisSelect
                        label="Delimiter"
                        value={advCsvDelimiter}
                        onChange={setAdvCsvDelimiter}
                        options={[
                          { value: "comma", label: "Comma (,) — default" },
                          { value: "semicolon", label: "Semicolon (;)" },
                          { value: "tab", label: "Tab" },
                          { value: "pipe", label: "Pipe (|)" },
                          { value: "custom", label: "Custom" },
                        ]}
                        disabled={isExporting}
                      />
                      {advCsvDelimiter === "custom" && (
                        <div style={fieldHelpWrap}>
                          <SharedTextField
                            label="Custom delimiter"
                            placeholder="e.g. ^"
                            value={advCsvDelimiterCustom}
                            onChange={setAdvCsvDelimiterCustom}
                            disabled={isExporting}
                          />
                          <s-text color="subdued">
                            A single character; the first one typed is used.
                          </s-text>
                        </div>
                      )}
                      <PolarisSelect
                        label="Quotes symbol"
                        value={advCsvQuote}
                        onChange={setAdvCsvQuote}
                        options={[
                          { value: "double", label: 'Double quote (") — default' },
                          { value: "single", label: "Single quote (')" },
                          { value: "custom", label: "Custom" },
                        ]}
                        disabled={isExporting}
                      />
                      {advCsvQuote === "custom" && (
                        <div style={fieldHelpWrap}>
                          <SharedTextField
                            label="Custom quotes symbol"
                            placeholder="e.g. ~"
                            value={advCsvQuoteCustom}
                            onChange={setAdvCsvQuoteCustom}
                            disabled={isExporting}
                          />
                          <s-text color="subdued">
                            A single character; the first one typed is used.
                          </s-text>
                        </div>
                      )}
                      <PolarisSelect
                        label="Newline symbol"
                        value={advCsvNewline}
                        onChange={setAdvCsvNewline}
                        options={[
                          { value: "crlf", label: "CRLF (General, Windows/MS-DOS) — default" },
                          { value: "lf", label: "LF (Linux/Unix/MacOS)" },
                          { value: "custom", label: "Custom" },
                        ]}
                        disabled={isExporting}
                      />
                      {advCsvNewline === "custom" && (
                        <div style={fieldHelpWrap}>
                          <SharedTextField
                            label="Custom newline symbol"
                            placeholder="e.g. \r\n"
                            value={advCsvNewlineCustom}
                            onChange={setAdvCsvNewlineCustom}
                            disabled={isExporting}
                          />
                          <s-text color="subdued">
                            Type \r for CR and \n for LF; other characters are used as-is.
                          </s-text>
                        </div>
                      )}
                      <PolarisSelect
                        label="File encoding"
                        value={advCsvEncoding}
                        onChange={setAdvCsvEncoding}
                        options={[
                          { value: "utf8", label: "UTF-8 — default" },
                          { value: "utf16le", label: "UTF-16 LE" },
                          { value: "latin1", label: "Windows-1252 / Latin-1" },
                        ]}
                        disabled={isExporting}
                      />
                      <PolarisCheckbox
                        label="Force quotes around every value"
                        checked={advCsvForceQuotes}
                        onChange={setAdvCsvForceQuotes}
                        disabled={isExporting}
                      />
                      <PolarisCheckbox
                        label="Include BOM character"
                        checked={advCsvBom}
                        onChange={setAdvCsvBom}
                        disabled={isExporting}
                      />
                    </div>
                  </div>
                </>
              )}

              <hr style={sectionRule} />

              {/* Notification — the finished file lands in the inbox. */}
              <div style={advRow}>
                <span style={advRowLabel}>Email when done</span>
                <div style={advRowBody}>
                  <div style={fieldHelpWrap}>
                    <SharedTextField
                      label="Email when done"
                      labelAccessibilityVisibility="exclusive"
                      placeholder="email@example.com — blank for none"
                      value={advEmailTo}
                      onChange={setAdvEmailTo}
                      disabled={isExporting}
                    />
                    <s-text color="subdued">
                      The finished file is emailed as an attachment. Separate several
                      recipients with commas.
                    </s-text>
                  </div>
                </div>
              </div>

              <hr style={sectionRule} />

              {/* Delivery — the run page's "Deliver to" picker, chosen
                  up-front: the finished file is pushed automatically. */}
              <div style={advRow}>
                <span style={advRowLabel}>Deliver to</span>
                <div style={{ ...advRowBody, maxWidth: 720 }}>
                  <div style={fieldHelpWrap}>
                    <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
                      <div ref={deliverTriggerRef} style={{ minWidth: 180 }}>
                        <s-clickable
                          command="--toggle"
                          commandFor="adv-deliver-popover"
                          disabled={isExporting ? true : undefined}
                          inlineSize="100%"
                          borderWidth="base"
                          borderStyle="solid"
                          borderColor="strong"
                          borderRadius="base"
                          paddingInline="small-100"
                          blockSize="32px"
                          background="base"
                        >
                          {(() => {
                            const sel = savedServers.find((s) => s.id === advDeliverTarget);
                            return (
                              <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
                                <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
                                  {!sel && <s-icon type="link" />}
                                  {sel ? `${sel.label} (${String(sel.protocol).toUpperCase()})` : "URL"}
                                </span>
                                <s-icon type="select" />
                              </s-grid>
                            );
                          })()}
                        </s-clickable>
                      </div>
                      <s-popover id="adv-deliver-popover" {...widthProps(Math.max(deliverTriggerWidth, 240))}>
                        <s-box padding="small-200">
                          <s-stack direction="block" gap="small-300">
                            {/* URL = ad-hoc destination typed in the field
                                beside; credentials ride in the URL and are
                                never saved with presets or schedules. */}
                            <PickerRow
                              icon={<s-icon type="link" />}
                              label="URL"
                              selected={!advDeliverTarget}
                              onSelect={() => {
                                setAdvDeliverTarget("");
                                setAdvDeliverUrl(typedDeliverUrl.current);
                              }}
                              popoverId="adv-deliver-popover"
                            />
                            {/* Navigates — adding a server lives on its own page. */}
                            <s-clickable
                              onClick={() => { setAddingServer(true); navigate("/app/servers"); }}
                              padding="small-200"
                              borderRadius="base"
                            >
                              <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
                                <span style={checkSlot}>
                                  {addingServer
                                    ? <s-spinner size="small" accessibilityLabel="Opening Servers" />
                                    : <s-icon type="plus" />}
                                </span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
                                  Add a new server
                                  <s-icon type="external" />
                                </span>
                              </s-grid>
                            </s-clickable>
                            <s-text color="subdued">Saved servers</s-text>
                            {savedServers.filter((s) => s.protocol !== "https").length === 0 && (
                              <s-text color="subdued">No saved servers yet.</s-text>
                            )}
                            {savedServers.filter((s) => s.protocol !== "https").map((s) => (
                              <PickerRow
                                key={s.id}
                                label={`${s.label} (${String(s.protocol).toUpperCase()})`}
                                selected={advDeliverTarget === s.id}
                                // Fill the field with the server's URL (username
                                // included; the stored password is injected
                                // server-side at send — it never reaches the
                                // browser). Append a folder to taste.
                                onSelect={() => {
                                  // Leaving URL mode: keep what was typed so
                                  // switching back restores it.
                                  if (!advDeliverTarget) typedDeliverUrl.current = advDeliverUrl;
                                  setAdvDeliverTarget(s.id);
                                  setAdvDeliverUrl(buildRemoteUrl(s, ""));
                                }}
                                popoverId="adv-deliver-popover"
                              />
                            ))}
                          </s-stack>
                        </s-box>
                      </s-popover>
                      <SharedTextField
                        label="Destination URL"
                        labelAccessibilityVisibility="exclusive"
                        placeholder="ftp://user:pass@host/folder — also ftps://, sftp://"
                        value={advDeliverUrl}
                        onChange={setAdvDeliverUrl}
                        disabled={isExporting}
                      />
                    </s-grid>
                    <s-text color="subdued">
                      Push the finished file to a saved FTP/SFTP/S3 server —
                      sent automatically right after the export completes.
                    </s-text>
                  </div>
                </div>
              </div>

            </s-stack>
            </div>
          )}
        </div>

        {/* Submit */}
        <s-section>
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
              <s-text color="subdued">
                {enabledEntities.length === 0
                  ? "No entities selected."
                  : `${enabledEntities.length} entit${enabledEntities.length === 1 ? "y" : "ies"} selected · estimated ${formatDuration(estimateSeconds(enabledEntities, counts))}`
                }
                {schedFetcher.data?.error ? ` — ${schedFetcher.data.error}` : ""}
              </s-text>
              <s-button
                variant="primary"
                icon={schedOnEnabled ? "calendar" : "download"}
                onClick={handleExport}
                disabled={!canSubmit ? true : undefined}
                loading={isExporting || schedFetcher.state !== "idle" ? true : undefined}
              >
                {schedOnEnabled ? "Schedule" : "Export"}
              </s-button>
            </s-grid>



          </s-stack>
        </s-section>

      </s-stack>
    </s-page>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────



/**
 * Pins a popover to an exact pixel width (min = max = inlineSize) so it
 * matches its trigger instead of sizing to its content. Returns nothing
 * until the trigger width has been measured.
 */
function widthProps(w) {
  if (!w) return {};
  const px = `${w}px`;
  return { inlineSize: px, minInlineSize: px, maxInlineSize: px };
}

/**
 * Measures an element's rendered width via ResizeObserver. Used to size a
 * popover to match its full-width trigger.
 */
function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * One selectable row in a picker popover (preset or format), styled like
 * Shopify's single-select field: a reserved left column holds a checkmark
 * for the selected option so every label aligns. Selecting it applies the
 * value and closes the popover via the declarative command.
 */
/* eslint-disable react/prop-types */
function PickerRow({ label, icon, selected, onSelect, popoverId }) {
  return (
    <s-clickable
      onClick={onSelect}
      command="--hide"
      commandFor={popoverId}
      padding="small-200"
      borderRadius="base"
      {...(selected ? { background: "subdued" } : {})}
    >
      <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
        <span style={checkSlot}>{selected ? <s-icon type="check" /> : null}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", ...(selected ? { fontWeight: 700 } : null) }}>
          {icon}
          {label}
        </span>
      </s-grid>
    </s-clickable>
  );
}

/**
 * A saved preset's row in the picker: the name applies it, and the three
 * actions beside it rename, duplicate or delete it without leaving the menu.
 * Renaming happens in place (Enter saves, the ✕ cancels) and deleting asks
 * first, both in the row itself so the popover never has to close.
 */
function PresetRow({
  preset: p, selected, renaming, renameText, confirmingDelete,
  onApply, onStartRename, onRenameText, onRename, onCancelRename,
  onDuplicate, onAskDelete, onCancelDelete, onDelete,
}) {
  if (renaming) {
    return (
      <s-grid gridTemplateColumns="1fr auto auto" gap="small-100" alignItems="center">
        <SharedTextField
          label="New name"
          labelAccessibilityVisibility="exclusive"
          value={renameText}
          onChange={onRenameText}
          onEnter={onRename}
        />
        <s-button variant="secondary" icon="check" accessibilityLabel="Save name" onClick={onRename} />
        <s-button variant="tertiary" icon="x" accessibilityLabel="Cancel rename" onClick={onCancelRename} />
      </s-grid>
    );
  }
  if (confirmingDelete) {
    return (
      <s-grid gridTemplateColumns="1fr auto auto" gap="small-100" alignItems="center">
        <s-text color="subdued">Delete “{p.name}”?</s-text>
        <s-button variant="secondary" tone="critical" onClick={onDelete}>Delete</s-button>
        <s-button variant="tertiary" onClick={onCancelDelete}>Cancel</s-button>
      </s-grid>
    );
  }
  return (
    <s-grid gridTemplateColumns="1fr auto auto auto" gap="small-100" alignItems="center">
      <s-clickable
        onClick={onApply}
        command="--hide"
        commandFor="preset-popover"
        padding="small-200"
        borderRadius="base"
        {...(selected ? { background: "subdued" } : {})}
      >
        <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
          <span style={checkSlot}>{selected ? <s-icon type="check" /> : null}</span>
          <span style={selected ? { fontWeight: 700 } : undefined}>{p.name}</span>
        </s-grid>
      </s-clickable>
      <s-button variant="tertiary" icon="edit" accessibilityLabel={`Rename ${p.name}`} onClick={onStartRename} />
      <s-button variant="tertiary" icon="duplicate" accessibilityLabel={`Duplicate ${p.name}`} onClick={onDuplicate} />
      <s-button variant="tertiary" icon="delete" accessibilityLabel={`Delete ${p.name}`} onClick={onAskDelete} />
    </s-grid>
  );
}
/* eslint-enable react/prop-types */

function initialEntityState() {
  const state = {};
  for (const e of ENTITIES) {
    state[e] = {
      enabled: false,
      filters: {},
      advancedFilters: [],
      selectedFields: [...(FIELDS_BY_ENTITY[e] ?? PRODUCT_FIELDS)],
      sort: [],
    };
  }
  return state;
}

/**
 * Rebuild the picker state from a stored job spec — powers "Latest Export"
 * across page loads. Filter rows regain fresh ids (the spec strips them).
 */
function stateFromSpec(spec) {
  const state = initialEntityState();
  for (const s of spec ?? []) {
    if (!state[s.entity]) continue;
    state[s.entity] = {
      enabled: true,
      filters: s.filters ?? {},
      advancedFilters: (s.advancedFilters ?? []).map((r) => ({ id: crypto.randomUUID(), ...r })),
      selectedFields: s.fields ?? [...(FIELDS_BY_ENTITY[s.entity] ?? PRODUCT_FIELDS)],
      sort: normalizeSortRules(s.sort),
    };
  }
  return state;
}

/**
 * Sort rules as a list of { id, column, direction } rows. Accepts the current
 * array shape and the legacy single-object shape (older specs and presets).
 */
function normalizeSortRules(sort) {
  const rules = Array.isArray(sort) ? sort : sort ? [sort] : [];
  return rules
    .filter((r) => r && r.column)
    .map((r) => ({
      id: r.id ?? crypto.randomUUID(),
      column: r.column,
      direction: r.direction === "desc" ? "desc" : "asc",
    }));
}

/** Re-shape a stored entityState whose sorts may still be legacy objects. */
function normalizeStateSorts(state) {
  const next = {};
  for (const [k, v] of Object.entries(state ?? {})) {
    next[k] = Array.isArray(v.sort) ? v : { ...v, sort: normalizeSortRules(v.sort) };
  }
  return next;
}

/**
 * Polaris <s-checkbox> wrapped with a native DOM `change` listener.
 * React 18's synthetic-event delegation can drop change events on
 * custom-element form controls, so we wire the listener directly to
 * the element via a ref.
 */
/* eslint-disable react/prop-types */
function PolarisCheckbox({ label, checked, onChange, disabled, labelAccessibilityVisibility, indeterminate }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => onChange(Boolean(e.target.checked));
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [onChange]);

  // Boolean attrs on custom elements must be present-or-absent;
  // passing `checked={false}` would still leave a string attribute.
  return (
    <s-checkbox
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(checked ? { checked: true } : {})}
      {...(indeterminate ? { indeterminate: true } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}

/**
 * One Matrixify-style collapsible column group: a group checkbox (toggles
 * the whole group, indeterminate when partial), a column count badge, and a
 * chevron that reveals the individual column checkboxes.
 */
function ColumnGroup({ group, selected, onToggleField, onSetGroup, disabled }) {
  const [open, setOpen] = useState(false);
  const lock = disabled ? true : undefined;
  const selCount = group.fields.reduce((n, f) => n + (selected.includes(f) ? 1 : 0), 0);
  const allSel = selCount === group.fields.length;
  const someSel = selCount > 0 && !allSel;

  return (
    <div style={detailGroup}>
      {/* Whole row toggles open (like the card header). The checkbox stops
          click propagation so ticking the group doesn't also expand it. */}
      <div className="eg-row" style={detailGroupRow} onClick={() => setOpen((o) => !o)}>
        <span
          style={{ pointerEvents: lock ? "none" : "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <PolarisCheckbox
            label={group.label}
            checked={allSel}
            indeterminate={someSel}
            onChange={(v) => onSetGroup(group.fields, v)}
            disabled={disabled}
          />
        </span>
        {group.speed && (
          <span
            style={{
              ...speedBadge,
              background: "#fbe6a2",
            }}
          >
            {group.speed}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".4rem" }}>
          {selCount > 0 && <s-badge>{selCount} columns</s-badge>}
          <s-button
            variant="tertiary"
            icon={open ? "chevron-up" : "chevron-down"}
            accessibilityLabel={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            disabled={lock}
          />
        </div>
      </div>
      {open && (
        <div style={columnsGrid}>
          {group.fields.map((field) => (
            // The whole box toggles the column; the checkbox is visual-only
            // (pointer-events disabled) so a single click never double-fires.
            <div
              key={field}
              className="eg-col"
              style={colRow}
              onClick={() => !disabled && onToggleField(field)}
            >
              <span style={{ pointerEvents: "none" }}>
                <PolarisCheckbox
                  label={FIELD_LABELS[field] ?? field}
                  checked={selected.includes(field)}
                  onChange={() => onToggleField(field)}
                  disabled={disabled}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Light-grey placeholder, lighter than Polaris's default subdued tone.
const PLACEHOLDER_COLOR = "#9a9ea3";

/**
 * Unsupported, best-effort override of the placeholder color. Polaris locks
 * form-control internals inside shadow DOM with no styling prop or CSS part,
 * so we walk the component's *open* shadow roots and inject a <style> into
 * whichever root directly holds the native input/textarea. No-ops if a root
 * is closed; may need revisiting across Polaris updates.
 */
function injectPlaceholderStyle(host) {
  const seen = new Set();
  const queue = [host];
  while (queue.length) {
    const node = queue.shift();
    const root = node.shadowRoot;
    if (!root || seen.has(root)) continue;
    seen.add(root);
    if (root.querySelector("input, textarea") && !root.querySelector("style[data-light-placeholder]")) {
      const style = document.createElement("style");
      style.setAttribute("data-light-placeholder", "");
      style.textContent =
        `input::placeholder, textarea::placeholder { color: ${PLACEHOLDER_COLOR} !important; opacity: 1; }`;
      root.appendChild(style);
      return true;
    }
    queue.push(...root.querySelectorAll("*"));
  }
  return false;
}

/** Applies injectPlaceholderStyle once the inner input has mounted. */
function useLightPlaceholder(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let tries = 0;
    let raf;
    const attempt = () => {
      if (injectPlaceholderStyle(el) || tries++ > 20) return;
      raf = requestAnimationFrame(attempt);
    };
    attempt();
    return () => raf && cancelAnimationFrame(raf);
  }, [ref]);
}

/**
 * Binds a Polaris form web component to React state. React's synthetic
 * onChange doesn't bind reliably to custom-element form controls, so we
 * attach native input/change listeners via a ref and push the value back
 * imperatively (only when it differs, to avoid clobbering the caret).
 */
function useWebInput(value, onChange) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => onChange(e.target.value);
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
  }, [onChange]);
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== (value ?? "")) el.value = value ?? "";
  }, [value]);
  return ref;
}

function PolarisTextField({ label, value, onChange, placeholder, disabled, labelAccessibilityVisibility }) {
  const ref = useWebInput(value, onChange);
  useLightPlaceholder(ref);
  return (
    <s-text-field
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(placeholder ? { placeholder } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}

// Polaris switch, bridged like the checkboxes (native change listener).
function PolarisSwitch({ label, checked, onChange }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(Boolean(e.target.checked));
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && Boolean(el.checked) !== Boolean(checked)) el.checked = Boolean(checked);
  }, [checked]);
  return <s-switch ref={ref} label={label} checked={checked ? true : undefined} />;
}

// Polaris date field (calendar picker + manual entry), bridged like the rest.
// `allow` restricts selectable dates ("YYYY-MM-DD--" = that day onward).
function PolarisDateField({ label, value, onChange, disabled, allow, labelAccessibilityVisibility }) {
  const ref = useWebInput(value, onChange);
  return (
    <s-date-field
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(allow ? { allow } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}

function PolarisSelect({ label, value, onChange, options, disabled, labelAccessibilityVisibility }) {
  const ref = useWebInput(value, onChange);
  return (
    <s-select
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(disabled ? { disabled: true } : {})}
    >
      {options.map((o) => (
        <s-option key={o.value} value={o.value}>{o.label}</s-option>
      ))}
    </s-select>
  );
}

/**
 * Filter + column configuration card for one enabled entity.
 * Mirrors the existing single-entity controls but keyed on a per-entity
 * state slice provided by the parent.
 */
function EntityConfigCard({ entity, state, count, dynGroups = EMPTY_DYN_GROUPS, onAddFilter, onUpdateFilter, onRemoveFilter, onToggleField, onSetFields, onAddSort, onUpdateSort, onRemoveSort, onRemove, disabled }) {
  const all = allFieldsFor(entity, dynGroups);
  const groups = groupsFor(entity, dynGroups);
  // Filter on the static columns only — the dynamic keys would bloat the
  // dropdown with a row per location/metafield/catalog.
  const columnOptions = (FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS).map((f) => ({ value: f, label: FIELD_LABELS[f] ?? f }));
  const [open, setOpen] = useState(false);
  // Column Order accordion (collapsed by default) + live drag state:
  // { field, from, to, dy, rowH } while a row is being dragged.
  const [colOpen, setColOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const colListRef = useRef(null);
  const lock = disabled ? true : undefined;

  // Toggle every field in a group at once. Newly ticked fields append to the
  // end rather than slotting into canonical order — otherwise a group toggle
  // would silently undo a column order you dragged.
  const setGroup = (fields, checked) => {
    if (checked) {
      const have = new Set(state.selectedFields);
      onSetFields([...state.selectedFields, ...fields.filter((f) => !have.has(f))]);
    } else {
      const drop = new Set(fields);
      onSetFields(state.selectedFields.filter((f) => !drop.has(f)));
    }
  };

  // Drag-to-reorder for the chosen columns — vertical only, pointer-driven.
  // The dragged row follows the pointer's Y; the rows it passes slide out of
  // the way with a CSS transition (the Reportify-style animation). The new
  // order commits on release; it's the column order of the exported file.
  const startColDrag = (e, field, index) => {
    if (lock) return;
    e.preventDefault();
    const rowsEls = colListRef.current?.querySelectorAll(".col-order-row");
    if (!rowsEls || rowsEls.length < 2) return;
    // Slot height = distance between two row tops (row height + gap).
    const rowH = rowsEls[1].getBoundingClientRect().top - rowsEls[0].getBoundingClientRect().top;
    const startY = e.clientY;
    const len = state.selectedFields.length;
    const clampDy = (y) => Math.max(-index * rowH, Math.min((len - 1 - index) * rowH, y - startY));
    const slotFor = (dy) => index + Math.round(dy / rowH);
    const onMove = (ev) => {
      const dy = clampDy(ev.clientY);
      setDrag({ field, from: index, to: slotFor(dy), dy, rowH });
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      const to = slotFor(clampDy(ev.clientY));
      if (to !== index) {
        const list = [...state.selectedFields];
        list.splice(index, 1);
        list.splice(to, 0, field);
        onSetFields(list);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDrag({ field, from: index, to: index, dy: 0, rowH });
  };
  // Alt+Arrow moves the focused column — drag-and-drop alone is unusable
  // without a mouse.
  const nudgeField = (field, delta) => {
    const list = [...state.selectedFields];
    const i = list.indexOf(field);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onSetFields(list);
  };

  return (
    <div style={entityCard}>
        {/* Header: entity icon + name on the left; summary stats, an expand
            chevron, and a remove (✕) button on the right. The header IS the
            whole collapsed card — a fixed 60px band, clickable edge to edge
            (a plain div card instead of s-section, whose built-in padding
            left dead unclickable zones around the header). */}
        <div style={cardHeader} onClick={() => setOpen((o) => !o)}>
          {ENTITY_ICONS[entity] && <s-icon type={ENTITY_ICONS[entity]} />}
          <span style={{ fontWeight: 700 }}>{entityDisplayName(entity)}</span>
          <div style={cardHeaderInfo}>
            <s-badge tone="success">{state.selectedFields.length} of {all.length} columns</s-badge>
            <s-badge tone="info">{count != null ? count.toLocaleString() : "—"} records</s-badge>
            {/* Same model as the overall estimate (throughput + fixed setup),
                so a lone selected sheet matches the total exactly. */}
            <s-badge>
              {Number.isFinite(Number(count))
                ? formatDuration(estimateSeconds([entity], { [entity]: count }))
                : "—"} estimated
            </s-badge>
          </div>
          {/* Chevron toggles too; stops propagation so the header's own
              onClick doesn't also fire (which would cancel the toggle). */}
          <s-button
            variant="tertiary"
            icon={open ? "chevron-up" : "chevron-down"}
            accessibilityLabel={open ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            disabled={lock}
          />
          {/* Remove must not toggle the header, so it stops propagation. */}
          <s-button
            variant="tertiary"
            icon="x"
            accessibilityLabel={`Remove ${entityDisplayName(entity)}`}
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            disabled={lock}
          />
        </div>

        {open && (
          <div style={entityCardBody}>
          <s-stack direction="block" gap="base">
            {/* Select Columns — comes first, like Matrixify */}
            <s-stack direction="block" gap="small-200">
              <span style={sectionHeader}>Columns</span>
              <div style={{ display: "flex" }}>
                <s-button
                  variant="secondary"
                  onClick={() => onSetFields(state.selectedFields.length === all.length ? [] : [...all])}
                  disabled={lock}
                >
                  {state.selectedFields.length === all.length ? "Clear all" : "Select all"}
                </s-button>
              </div>
              <div>
                {groups.map((group) => (
                  <ColumnGroup
                    key={group.label}
                    group={group}
                    selected={state.selectedFields}
                    onToggleField={onToggleField}
                    onSetGroup={setGroup}
                    disabled={disabled}
                  />
                ))}
              </div>
            </s-stack>

            {state.selectedFields.length === 0 && (
              <s-banner tone="warning">
                Select at least one column for {entityDisplayName(entity)} or untick the entity above.
              </s-banner>
            )}

            {/* Column order — collapsed accordion; expand to drag columns
                into the order they'll appear in the exported file. Ruled off
                above and below so it reads as its own section. */}
            {state.selectedFields.length > 1 && (
              <>
              {/* Rules live OUTSIDE the accordion's tight stack, as siblings
                  in the card's base-gap flow — equal air on both sides, so
                  they read as section separators rather than button trim. */}
              <hr style={sectionRule} />
              <s-stack direction="block" gap="small-200">
                <div style={{ display: "flex" }}>
                  <s-button
                    variant="secondary"
                    icon={colOpen ? "chevron-up" : "chevron-down"}
                    onClick={() => setColOpen((o) => !o)}
                    disabled={lock}
                  >
                    Column order
                  </s-button>
                </div>

                {colOpen && (
                  <>
                    <div style={colOrderHintRow}>
                      <s-text color="subdued">Drag to reorder · Alt + ↑ ↓</s-text>
                      <span style={{ marginLeft: "auto" }}>
                        <s-button
                          variant="secondary"
                          onClick={() => onSetFields(all.filter((f) => state.selectedFields.includes(f)))}
                          disabled={lock}
                        >
                          Reset order
                        </s-button>
                      </span>
                    </div>
                    <div ref={colListRef} className="sheet-scroll" style={colOrderList}>
                      {state.selectedFields.map((f, i) => {
                        // While dragging: the held row follows the pointer;
                        // rows it has passed slide one slot the other way.
                        let style;
                        if (drag) {
                          if (f === drag.field) {
                            style = {
                              transform: `translateY(${drag.dy}px)`, transition: "none",
                              position: "relative", zIndex: 2,
                              boxShadow: "0 4px 12px rgba(0,0,0,.18)",
                            };
                          } else {
                            let shift = 0;
                            if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -1;
                            else if (drag.to < drag.from && i >= drag.to && i < drag.from) shift = 1;
                            style = { transform: `translateY(${shift * drag.rowH}px)` };
                          }
                        }
                        return (
                          <button
                            key={f}
                            type="button"
                            className={`col-order-row${drag?.field === f ? " dragging" : ""}`}
                            style={style}
                            aria-label={`${FIELD_LABELS[f] ?? f}, column ${i + 1} of ${state.selectedFields.length}. Alt plus arrow keys to move.`}
                            onPointerDown={(e) => startColDrag(e, f, i)}
                            onKeyDown={(e) => {
                              if (!e.altKey) return;
                              if (e.key === "ArrowUp") { e.preventDefault(); nudgeField(f, -1); }
                              if (e.key === "ArrowDown") { e.preventDefault(); nudgeField(f, 1); }
                            }}
                            disabled={lock}
                          >
                            <span className="col-drag-handle">
                              <s-icon type="drag-handle" />
                            </span>
                            <span style={colOrderIndex}>{i + 1}</span>
                            <span>{FIELD_LABELS[f] ?? f}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </s-stack>
              <hr style={sectionRule} />
              </>
            )}

            {/* Set Filters — dynamic builder: each row is column + condition +
                value + remove. "Add filter" appends a blank row. */}
            <s-stack direction="block" gap="small-200">
              <span style={sectionHeader}>Filters</span>
              {state.advancedFilters.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                  {state.advancedFilters.map((row) => {
                    const valueless = VALUELESS_OPERATORS.has(row.operator);
                    return (
                      <div key={row.id} style={advFilterRow}>
                        <PolarisSelect
                          label="Column"
                          labelAccessibilityVisibility="exclusive"
                          value={row.column}
                          onChange={(v) => onUpdateFilter(row.id, { column: v })}
                          options={columnOptions}
                          disabled={disabled}
                        />
                        <PolarisSelect
                          label="Condition"
                          labelAccessibilityVisibility="exclusive"
                          value={row.operator}
                          onChange={(v) => onUpdateFilter(row.id, { operator: v })}
                          options={FILTER_OPERATORS}
                          disabled={disabled}
                        />
                        <PolarisTextField
                          label="Value"
                          labelAccessibilityVisibility="exclusive"
                          value={valueless ? "" : row.value}
                          onChange={(v) => onUpdateFilter(row.id, { value: v })}
                          placeholder={valueless ? "—" : placeholderFor(row.column)}
                          disabled={disabled || valueless}
                        />
                        <s-clickable
                          accessibilityLabel="Remove filter"
                          onClick={() => onRemoveFilter(row.id)}
                          disabled={lock}
                          inlineSize="32px"
                          blockSize="32px"
                          borderWidth="base"
                          borderStyle="solid"
                          borderColor="strong"
                          borderRadius="base"
                          background="base"
                        >
                          <div style={squareIconBox}>
                            <s-icon type="delete" />
                          </div>
                        </s-clickable>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex" }}>
                <s-button icon="plus" variant="secondary" onClick={onAddFilter} disabled={lock}>
                  Add filter
                </s-button>
              </div>
            </s-stack>

            {/* Same section separator as around Column order, so Filters and
                Sorting read as distinct sections rather than one block. The
                negative margin tightens the card's base gap on both sides. */}
            <hr style={{ ...sectionRule, margin: "-0.25rem 0" }} />

            {/* Sort — reorders whole records by column values; rules apply in
                order (the first breaks ties for none, the second breaks the
                first's ties, …). Multi-row records travel with their top row. */}
            <s-stack direction="block" gap="small-200">
              <span style={sectionHeader}>Sorting</span>
              {(state.sort ?? []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                  {state.sort.map((row) => (
                    <div key={row.id} style={sortRow}>
                      <PolarisSelect
                        label="Sort by"
                        labelAccessibilityVisibility="exclusive"
                        value={row.column}
                        onChange={(v) => onUpdateSort(row.id, { column: v })}
                        options={[{ value: "", label: "— Select column —" }, ...columnOptions]}
                        disabled={disabled}
                      />
                      <PolarisSelect
                        label="Direction"
                        labelAccessibilityVisibility="exclusive"
                        value={row.direction}
                        onChange={(v) => onUpdateSort(row.id, { direction: v })}
                        options={[
                          { value: "asc", label: "Ascending" },
                          { value: "desc", label: "Descending" },
                        ]}
                        disabled={disabled || !row.column}
                      />
                      <s-clickable
                        accessibilityLabel="Remove sort"
                        onClick={() => onRemoveSort(row.id)}
                        disabled={lock}
                        inlineSize="32px"
                        blockSize="32px"
                        borderWidth="base"
                        borderStyle="solid"
                        borderColor="strong"
                        borderRadius="base"
                        background="base"
                      >
                        <div style={squareIconBox}>
                          <s-icon type="delete" />
                        </div>
                      </s-clickable>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex" }}>
                <s-button icon="plus" variant="secondary" onClick={onAddSort} disabled={lock}>
                  Add sort
                </s-button>
              </div>
            </s-stack>
          </s-stack>
          </div>
        )}
    </div>
  );
}
/* eslint-enable react/prop-types */

// ─── styles (form inputs only; layout uses Polaris) ──────────────────────────

// Pale-yellow "Slow" speed pill, styled to match an s-badge.
const speedBadge = {
  display: "inline-flex", alignItems: "center",
  padding: "0 .5rem", borderRadius: "8px",
  fontSize: ".72rem", fontWeight: 500, lineHeight: "20px",
  color: "#5c4813",
};
// Centers the trash icon inside its fixed 32×32 square button.
const squareIconBox = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: "100%", height: "100%",
};
// One dynamic filter row: column · condition · value · trash button.
const advFilterRow = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1.3fr) minmax(150px, 1.3fr) minmax(140px, 1.6fr) auto",
  gap: ".5rem",
  alignItems: "end",
};
// Sheets section: title on the left, "Select sheets" picker on the right.
const sheetsHeader = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: "1rem", flexWrap: "wrap",
};
const sheetsTitle = {
  fontSize: "0.875rem", fontWeight: 650,
};
// Entity table: bordered, capped height with a sticky header (32 rows would
// otherwise push the rest of the page down).
const sheetTableWrap = {
  border: "1px solid #e3e5e7", borderRadius: 8,
  maxHeight: 358, overflow: "auto",
};
const sheetTable = {
  borderCollapse: "collapse", width: "100%",
};
const sheetTh = {
  padding: ".5rem .75rem", fontSize: ".75rem", fontWeight: 600,
  color: "#616a75", whiteSpace: "nowrap",
};
// Column alignment → flex justification for the header cells.
const TH_ALIGN = { left: "flex-start", center: "center", right: "flex-end" };
const sheetTd = {
  padding: ".4rem .75rem", fontSize: ".8125rem",
  borderTop: "1px solid #f1f2f3", whiteSpace: "nowrap",
};
const sheetTdEntity = {
  display: "inline-flex", alignItems: "center", gap: ".5rem", fontWeight: 600,
};
// Fixed slot keeps every label aligned even when an entity has no icon.
const sheetPickIcon = {
  width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
// Advanced card: plain div with the app's card chrome; the toggle button
// carries the padding, so the whole collapsed card is the click target.
const advCard = {
  background: "#ffffff", border: "1px solid #e3e5e7", borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.05)", overflow: "hidden",
};
// Advanced options: accordion header + Matrixify-style label/body rows.
const advHeader = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: "1rem", minHeight: 28,
};
const advRow = {
  display: "grid", gridTemplateColumns: "160px minmax(0, 1fr)",
  gap: "1rem", alignItems: "start",
};
const advRowLabel = {
  fontSize: ".8125rem", fontWeight: 600, paddingTop: ".35rem",
};
const advRowBody = {
  display: "flex", flexDirection: "column", gap: ".5rem", maxWidth: 520,
};
// Expanded contents: the card padding the toggle doesn't cover (the button's
// own bottom padding provides the air below the header).
const advContent = { padding: "0 1rem 1rem" };
// Field + its helper text as one tight unit — the Polaris helpText gap
// (~4px), not the card's section gap.
const fieldHelpWrap = {
  display: "flex", flexDirection: "column", gap: 4,
};
// Small field label inside the Options card, above each control. The top
// margin is the field-to-field rhythm — 1rem, like the admin's own forms.
const optionLabel = {
  display: "block", fontSize: ".8125rem", fontWeight: 600,
  marginTop: "1rem", marginBottom: ".25rem",
};
// Reserved left column in picker rows so the selected option's checkmark
// sits to the left and all labels stay aligned (Shopify single-select look).
const checkSlot = {
  width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
// Entity sheet card: a plain div (not s-section) so the header band reaches
// the card edges — every pixel of a collapsed card toggles it.
const entityCard = {
  background: "#ffffff", border: "1px solid #e3e5e7", borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.05)", overflow: "hidden",
};
const entityCardBody = { padding: "0 1rem 1rem" };
const cardHeader = {
  display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer",
  // Exactly 60px tall, edge to edge — the collapsed card IS this band.
  height: 60, paddingInline: "1rem", boxSizing: "border-box",
};
const cardHeaderInfo = {
  marginLeft: "auto", display: "flex", flexDirection: "row",
  alignItems: "center", gap: ".25rem",
};
const sectionHeader = {
  fontSize: ".78rem", fontWeight: 600, color: "#6d7175",
};
// Inline-scheduling boxed layout: labeled cells in a two-column grid. The
// Scheduling row body runs wider than the other Advanced rows.
const schedGrid = {
  display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: ".75rem", maxWidth: 640,
};
const schedRowBody = {
  display: "flex", flexDirection: "column", gap: ".75rem", maxWidth: 720,
};
// Sort rule row: column select + direction select + remove button.
const sortRow = {
  display: "grid", gridTemplateColumns: "minmax(160px, 1.6fr) minmax(130px, 1fr) 32px",
  gap: ".5rem", maxWidth: 500, alignItems: "center",
};
// Hairline rule setting the Column order section apart from its neighbours.
const sectionRule = {
  border: 0, borderTop: "1px solid #f1f2f3", margin: 0, width: "100%",
};
// Hint + reset row shown when the accordion is open.
const colOrderHintRow = {
  display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap",
};
// Capped so a 45-column entity doesn't turn the card into a mile of rows.
const colOrderList = {
  display: "flex", flexDirection: "column", gap: ".25rem",
  maxHeight: 440, overflowY: "auto", paddingRight: ".25rem",
};
const colOrderIndex = {
  minWidth: 22, fontSize: ".6875rem", color: "#8a9199", textAlign: "right",
};
const detailGroup = {
  borderTop: "1px solid #e3e5e7",
};
const detailGroupRow = {
  display: "flex", alignItems: "center", gap: ".5rem",
  padding: ".4rem .5rem", cursor: "pointer", borderRadius: 6,
};
const columnsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "0 .5rem",
  paddingInlineStart: "1.75rem",
  paddingBlockEnd: ".35rem",
};
const colRow = {
  padding: ".2rem .5rem", borderRadius: 6, cursor: "pointer",
};
