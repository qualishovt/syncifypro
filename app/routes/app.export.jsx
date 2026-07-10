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

import { useState, useEffect, useRef, useMemo } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import { startExport } from "../export/exportJob.js";
import { extractTranslations } from "../export/entities/translations.js";
import { getJob, countJobsForShop } from "../db/bulkExportJob.server.js";
import { FIELDS_BY_ENTITY, PRODUCT_FIELDS, COLUMN_GROUPS_BY_ENTITY, FIELD_LABELS, placeholderFor } from "../export/fieldLists.js";
import { buildInventoryFieldKeys } from "../export/inventoryColumns.js";
import { buildMetafieldFieldKeys, PRODUCT_MF_PREFIX, VARIANT_MF_PREFIX } from "../export/metafieldColumns.js";
import { buildCatalogFieldKeys } from "../export/catalogColumns.js";

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
    discountNodesCount { count }
    pagesCount { count }
    blogsCount { count }
    urlRedirectsCount { count }
    companiesCount { count }
    draftOrdersCount { count }
    locationsCount { count }
    catalogsCount { count }
  }
`;

const COUNT_FIELD_BY_ENTITY = {
  products: "productsCount",
  orders: "ordersCount",
  customers: "customersCount",
  collections: "collectionsCount",
  smart_collections: "collectionsCount",
  custom_collections: "collectionsCount",
  discounts: "discountNodesCount",
  pages: "pagesCount",
  blogs: "blogsCount",
  redirects: "urlRedirectsCount",
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

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const wantData = url.searchParams.get("data") === "1";

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
    return { polledJob, counts: {}, productDynamic: EMPTY_PRODUCT_DYNAMIC, ready: false, presets: [], defaultFormat: "csv", blockedEntities: [] };
  }

  const { listPresets } = await import("../db/exportPreset.server.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const presets = (await listPresets(session.shop)).map(serializePreset);
  const { defaultExportFormat: defaultFormat, blockedEntities } = await getAppSettings(session.shop);

  // The heavy work — entity row counts + product dynamic columns (several Admin
  // API calls). We DON'T run it on the initial page load, so the page opens
  // instantly; the client immediately re-fetches with ?data=1 to fill it in.
  if (wantData) {
    // Run the independent (and slowest — translations) queries concurrently so
    // the loader waits for the longest, not the sum.
    const [entityCounts, translations, dynamic] = await Promise.all([
      getEntityCounts(admin),
      getTranslationsCount(admin),
      getProductDynamic(admin),
    ]);
    const counts = entityCounts;
    counts.shop = 1; // singleton
    if (translations != null) counts.translations = translations;
    Object.assign(counts, await getDerivedCounts(admin, counts.pages)); // metaobjects, content, menus
    try {
      counts.activity = await countJobsForShop(session.shop); // app-owned entity
    } catch { /* leave as "—" */ }
    return { polledJob: null, counts, productDynamic: dynamic, ready: true, presets, defaultFormat, blockedEntities };
  }

  // Initial page load: return the shell instantly. Counts arrive via ?data=1.
  return { polledJob: null, counts: {}, productDynamic: EMPTY_PRODUCT_DYNAMIC, ready: false, presets, defaultFormat, blockedEntities };
}

// A stored preset → the shape the export UI uses (entityState + format), plus
// the built spec that a Schedule can run.
function serializePreset(p) {
  let state = null, spec = [];
  try { state = p.state ? JSON.parse(p.state) : null; } catch { /* ignore */ }
  try { spec = JSON.parse(p.spec); } catch { /* ignore */ }
  return { id: p.id, name: p.name, format: p.format, entityState: state, spec };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const format = formData.get("format") ?? "csv";
  const intent = formData.get("intent");

  // Save / delete a named export preset (server-persisted so it sticks and can
  // be picked by a Schedule).
  if (intent === "savePreset") {
    const { savePreset } = await import("../db/exportPreset.server.js");
    const name = String(formData.get("name") || "").trim();
    if (!name) return data({ error: "Preset name is required." }, { status: 400 });
    let spec = [], state = null;
    try { spec = JSON.parse(String(formData.get("spec") || "[]")); } catch { /* ignore */ }
    try { state = formData.get("state") ? JSON.parse(String(formData.get("state"))) : null; } catch { /* ignore */ }
    const p = await savePreset({ shop: session.shop, name, format, spec, state });
    return { presetSaved: true, preset: { id: p.id, name: p.name, format: p.format, entityState: state, spec } };
  }
  if (intent === "deletePreset") {
    const { deletePreset } = await import("../db/exportPreset.server.js");
    await deletePreset(session.shop, String(formData.get("id")));
    return { presetDeleted: true, id: String(formData.get("id")) };
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
  const blocked = new Set(blockedEntities);
  specs = specs.filter((s) => !blocked.has(s.entity));
  if (specs.length === 0) {
    return data({ error: "Those entities are disabled in Sheet Permissions (Settings)." }, { status: 400 });
  }

  try {
    // Every export runs as a tracked job now (in-process for direct-size,
    // Shopify bulk for huge stores) so the UI can poll for progress.
    return await startExport({ admin, shop: session.shop, specs, format });
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const ENTITIES = ["products", "orders", "customers", "collections", "discounts", "content", "draft_orders", "redirects", "shop", "files", "payouts", "menus", "companies", "locations", "catalogs", "inventory_transfers", "activity", "metaobjects", "definitions", "translations"];
const FORMATS = ["csv", "excel", "xml", "json"];
const FORMAT_LABELS = { csv: "CSV", excel: "Excel", xml: "XML", json: "JSON" };

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

// Polaris s-icon type per entity.
const ENTITY_ICONS = {
  products: "product",
  orders: "order",
  customers: "person",
  collections: "collection",
  smart_collections: "collection",
  custom_collections: "collection",
  discounts: "discount",
  pages: "page",
  blogs: "blog",
  articles: "note",
  redirects: "link",
  shop: "store",
  files: "image",
  payouts: "bank",
  menus: "menu",
  companies: "store-managed",
  draft_orders: "order-draft",
  activity: "clock",
  metaobjects: "database",
  metaobject_definitions: "database",
  metafields: "metafields",
  translations: "language-translate",
  locations: "location",
  catalogs: "collection-list",
  inventory_transfers: "transfer-in",
  content: "page",
  definitions: "data-table",
};

export default function ExportPage() {
  const loaderData = useLoaderData();
  const dataFetcher = useFetcher(); // lazily fetches the heavy counts + dynamic columns
  const presetFetcher = useFetcher(); // persists saved presets

  // The page shell renders immediately; kick off the counts fetch on mount so
  // they populate a moment later (instead of blocking the page from opening).
  useEffect(() => {
    if (!loaderData.ready) dataFetcher.load("/app/export?data=1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = dataFetcher.data?.counts ?? loaderData.counts;
  const productDynamic = dataFetcher.data?.productDynamic ?? loaderData.productDynamic;
  const countsLoading = !loaderData.ready && !dataFetcher.data;

  // Dynamic product groups (inventory, metafields, variant metafields,
  // catalog pricing), derived from store data. Empty groups are omitted.
  const productDynamicGroups = useMemo(
    () => buildProductDynamicGroups(productDynamic ?? EMPTY_PRODUCT_DYNAMIC),
    [productDynamic],
  );
  const dynGroupsFor = (entity) => (entity === "products" ? productDynamicGroups : EMPTY_DYN_GROUPS);

  const [format, setFormat] = useState(loaderData.defaultFormat ?? "csv");

  // Preset state. "Latest Export" and "New Export" are built-in presets;
  // savedPresets holds user-saved configurations. presetName backs the
  // save modal's input; lastConfig captures the most recent export so
  // "Latest Export" can restore it.
  const [preset, setPreset] = useState("New Export");
  const [savedPresets, setSavedPresets] = useState(() => loaderData.presets ?? []);
  const [presetName, setPresetName] = useState("");
  const [lastConfig, setLastConfig] = useState(null);

  // Per-entity state: { enabled, filters: {key→value}, selectedFields: string[] }
  const [entityState, setEntityState] = useState(() => initialEntityState());

  // Sheet Permissions (Settings): entities blocked there are hidden here and
  // can't be exported. `visibleEntities` drives both the cards and the specs.
  const blocked = new Set(loaderData.blockedEntities ?? []);
  const visibleEntities = ENTITIES.filter((e) => !blocked.has(e));
  const enabledEntities = visibleEntities.filter((e) => entityState[e].enabled);

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

  const fetcher = useFetcher();
  const pollFetcher = useFetcher();
  const [pollingJobId, setPollingJobId] = useState(null);

  // The current job's live status — but ONLY when it belongs to THIS export.
  // pollFetcher.data can still hold the previous job's result (e.g. 100%), so
  // gating on jobId stops the progress bar from flashing the old value and
  // "jumping back" the moment a new export starts.
  const poll = (pollFetcher.data?.polledJob?.jobId === pollingJobId
    ? pollFetcher.data.polledJob
    : null)
    ?? (loaderData.polledJob?.jobId === pollingJobId ? loaderData.polledJob : null);

  // Each popover matches the width of its full-width trigger (s-popover has
  // no "match trigger" option), so we measure the trigger and feed its pixel
  // width into the popover's inlineSize.
  const [formatTriggerRef, formatTriggerWidth] = useElementWidth();
  const [presetTriggerRef, presetTriggerWidth] = useElementWidth();

  const isExporting = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if ((result?.mode === "bulk" || result?.mode === "job") && result.jobId) setPollingJobId(result.jobId);
  }, [result]);

  // Opened from a Recent-activity "#" link (/app/export?jobId=…) — show that job.
  useEffect(() => {
    if (loaderData.polledJob?.jobId) setPollingJobId(loaderData.polledJob.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One immediate poll when a NEW export starts, so the job + progress show up
  // right away. Keyed only on pollingJobId (NOT pollFetcher) so it fires once
  // per job — depending on pollFetcher would re-fire on every load and storm
  // the server ("Failed to fetch").
  useEffect(() => {
    if (pollingJobId) pollFetcher.load(`/app/export?jobId=${pollingJobId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingJobId]);

  // Then poll every 3s until the job finishes.
  useEffect(() => {
    if (!pollingJobId) return;
    if (poll?.status === "complete" || poll?.status === "failed") return;
    const interval = setInterval(() => {
      pollFetcher.load(`/app/export?jobId=${pollingJobId}`);
    }, 3000);
    return () => clearInterval(interval);
  }, [pollingJobId, poll?.status, pollFetcher]);

  // Apply a preset: built-ins reset or restore the last export; a saved
  // preset restores its stored format + entity configuration.
  function applyPreset(name) {
    setPreset(name);
    if (name === "New Export") {
      setEntityState(initialEntityState());
      setFormat(loaderData.defaultFormat ?? "csv");
    } else if (name === "Latest Export") {
      if (lastConfig) { setFormat(lastConfig.format); setEntityState(lastConfig.entityState); }
    } else {
      const p = savedPresets.find((s) => s.name === name);
      if (p) { setFormat(p.format); setEntityState(p.entityState); }
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

      return { entity: e, filters, fields, advancedFilters };
    });
  }

  // Save the current configuration as a named preset — persisted server-side so
  // it survives reloads and can be picked by a Schedule.
  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const spec = buildSpecs();
    presetFetcher.submit(
      { intent: "savePreset", name, format, spec: JSON.stringify(spec), state: JSON.stringify(entityState) },
      { method: "post" },
    );
    setSavedPresets((prev) => [...prev.filter((p) => p.name !== name), { name, format, entityState, spec }]);
    setPreset(name);
    setPresetName("");
  }

  function handleExport() {
    setPollingJobId(null);
    setLastConfig({ format, entityState });

    const formData = new FormData();
    formData.set("format", format);
    formData.set("specs", JSON.stringify(buildSpecs()));

    fetcher.submit(formData, { method: "post" });
  }

  // Resolve the file the user should see now:
  //   - direct mode returns inline,
  //   - bulk mode arrives later via the polling fetcher.
  const downloadResult = (() => {
    if (result?.mode === "direct") return result;
    if (poll?.status === "complete") return poll;
    return null;
  })();

  const bulkError = poll?.status === "failed" ? poll.error ?? "Export failed" : null;

  const isPolling = pollingJobId &&
    poll?.status !== "complete" &&
    poll?.status !== "failed";

  // Allow export when at least one entity is ticked and each ticked entity
  // still has at least one column selected.
  const canSubmit =
    enabledEntities.length > 0 &&
    enabledEntities.every((e) => entityState[e].selectedFields.length > 0) &&
    !isExporting && !isPolling;

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
        loading={isExporting || isPolling ? true : undefined}
      >
        Export
      </s-button>
      <s-button slot="secondary-actions" variant="tertiary" icon="arrow-left" href="/app">Back</s-button>
      {/* Hover highlight for column groups and their column rows. */}
      <style>{`
        .eg-row, .eg-col { transition: background-color .1s ease; }
        .eg-row:hover, .eg-col:hover { background: #f6f6f7; }
        @keyframes eg-indeterminate { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
      `}</style>
      <s-stack direction="block" gap="base">

        {/* ── Entities card ────────────────────────────────────────── */}
        <s-section heading="Entities to export">
          <s-stack direction="block" gap="base">
            <div style={entityGrid}>
              {visibleEntities.map((e) => {
                const enabled = entityState[e].enabled;
                const locked = isExporting || isPolling;
                return (
                  <div
                    key={e}
                    onClick={() => { if (!locked) setEntityEnabled(e, !enabled); }}
                    style={{
                      ...entityBox,
                      background: enabled ? "#e3e5e7" : "#fff",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.6 : 1,
                    }}
                  >
                    {/* Order: checkbox → icon → text. The whole box handles the
                        click, so the checkbox must not capture pointer events
                        (no double toggle). Its label is kept for screen readers
                        only; the visible text is rendered separately after the icon. */}
                    <span style={{ pointerEvents: "none", display: "inline-flex" }}>
                      <PolarisCheckbox
                        label={entityDisplayName(e)}
                        labelAccessibilityVisibility="exclusive"
                        checked={enabled}
                        onChange={(v) => setEntityEnabled(e, v)}
                        disabled={locked}
                      />
                    </span>
                    {ENTITY_ICONS[e] && <s-icon type={ENTITY_ICONS[e]} size="small" />}
                    <span style={entityLabel}>{entityDisplayName(e)}</span>
                    <span style={entityCount}>
                      {counts?.[e] != null
                        ? <s-badge>{counts[e].toLocaleString()}</s-badge>
                        : (countsLoading ? <s-text color="subdued">…</s-text> : "—")}
                    </span>
                  </div>
                );
              })}
            </div>

            {enabledEntities.length === 0 && (
              <s-banner tone="info">
                Tick one or more entities above. Each ticked entity gets its own
                filter + column card below.
              </s-banner>
            )}
          </s-stack>
        </s-section>

        {/* ── Preset + Format row (50/50) ─────────────────────────────── */}
        <div style={twoColRow}>

        {/* ── Preset card ──────────────────────────────────────────────
            Same trigger+popover pattern as Format, with a Save button beside
            it that opens a modal to store the current configuration. */}
        <s-section heading="Preset">
          <div style={{ display: "flex", gap: ".5rem", alignItems: "stretch" }}>
            <div ref={presetTriggerRef} style={{ flex: 1, minWidth: 0 }}>
              <s-clickable
                command="--toggle"
                commandFor="preset-popover"
                disabled={isExporting || isPolling ? true : undefined}
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
            <s-button
              commandFor="save-preset-modal"
              disabled={isExporting || isPolling ? true : undefined}
            >
              Save
            </s-button>
          </div>
          <s-popover id="preset-popover" {...widthProps(presetTriggerWidth)}>
            <s-box padding="small-200">
              <s-stack direction="block" gap="small-300">
                {PRESET_BUILTIN.map((name) => (
                  <PickerRow key={name} label={name} selected={preset === name} onSelect={() => applyPreset(name)} popoverId="preset-popover" />
                ))}
                <s-text color="subdued">Saved</s-text>
                {savedPresets.length === 0 ? (
                  <s-text color="subdued">No saved exports yet.</s-text>
                ) : (
                  savedPresets.map((p) => (
                    <PickerRow key={p.name} label={p.name} selected={preset === p.name} onSelect={() => applyPreset(p.name)} popoverId="preset-popover" />
                  ))
                )}
              </s-stack>
            </s-box>
          </s-popover>

          {/* Save-configuration modal */}
          <s-modal id="save-preset-modal" heading="Save preset">
            <PolarisTextField
              label="Preset name"
              value={presetName}
              onChange={setPresetName}
              placeholder="e.g. Weekly products"
            />
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={savePreset}
              command="--hide"
              commandFor="save-preset-modal"
            >
              Save
            </s-button>
            <s-button slot="secondary-actions" command="--hide" commandFor="save-preset-modal">
              Cancel
            </s-button>
          </s-modal>
        </s-section>

        {/* ── Format card ──────────────────────────────────────────────
            The trigger button (full width) shows the current format and uses
            commandFor to open the popover. Inside, each format is a clickable
            row that highlights and shows a checkmark when selected. */}
        <s-section heading="Format">
          {/* Block-level wrapper is naturally full width — measuring it gives
              the true rendered button width to mirror onto the popover. */}
          <div ref={formatTriggerRef} style={{ width: "100%" }}>
            <s-clickable
              command="--toggle"
              commandFor="format-popover"
              disabled={isExporting || isPolling ? true : undefined}
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
                    selected={format === f}
                    onSelect={() => setFormat(f)}
                    popoverId="format-popover"
                  />
                ))}
              </s-stack>
            </s-box>
          </s-popover>
        </s-section>

        </div>

        {/* One configuration card per enabled entity */}
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
            onRemove={() => setEntityEnabled(e, false)}
            disabled={isExporting || isPolling}
          />
        ))}

        {/* Submit */}
        <s-section>
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
              <s-text color="subdued">
                {enabledEntities.length === 0
                  ? "No entities selected."
                  : `${enabledEntities.length} entit${enabledEntities.length === 1 ? "y" : "ies"} selected.`
                }
              </s-text>
              <s-button
                variant="primary"
                icon="download"
                onClick={handleExport}
                disabled={!canSubmit ? true : undefined}
                loading={isExporting || isPolling ? true : undefined}
              >
                Export
              </s-button>
            </s-grid>

            {/* Errors */}
            {(result?.error || bulkError) && (
              <s-banner tone="critical">{result?.error ?? bulkError}</s-banner>
            )}

            {/* Export progress — opens the moment Export is clicked */}
            {(isExporting || isPolling) && (() => {
              const cur = poll?.progressCurrent ?? 0;
              const tot = poll?.progressTotal ?? null;
              const pct = tot ? Math.min(100, Math.round((cur / tot) * 100)) : null;
              return (
                <s-banner tone="info">
                  <s-stack direction="block" gap="small-200">
                    <s-text>Exporting…{pct != null ? ` ${pct}%` : ""}</s-text>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={tot ?? undefined}
                      aria-valuenow={pct != null ? cur : undefined}
                      style={{ width: "100%", height: 8, background: "#e3e5e7", borderRadius: 4, overflow: "hidden" }}
                    >
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 4,
                          background: "#2c6ecb",
                          width: pct != null ? `${pct}%` : "30%",
                          transition: "width .3s ease",
                          ...(pct == null ? { animation: "eg-indeterminate 1.2s ease-in-out infinite" } : {}),
                        }}
                      />
                    </div>
                    <s-text color="subdued">
                      {tot != null
                        ? `${cur.toLocaleString()} / ${tot.toLocaleString()} records`
                        : cur > 0
                          ? `${cur.toLocaleString()} records processed…`
                          : "Processing your export…"}
                    </s-text>
                  </s-stack>
                </s-banner>
              );
            })()}

            {/* Download */}
            {downloadResult?.signedUrl && (
              <div style={downloadBox}>
                <div style={downloadHead}>
                  <span style={downloadCheck}>
                    <s-icon type="check-circle" tone="success" />
                  </span>
                  <span style={downloadTitle}>Your file is ready</span>
                </div>
                <div style={downloadFileRow}>
                  <span style={downloadFile}>{upperFirst(downloadResult.filename)}</span>
                  {downloadResult.rowCount ? (
                    <s-text color="subdued">· {downloadResult.rowCount.toLocaleString()} rows</s-text>
                  ) : null}
                </div>
                <div>
                  <s-button variant="primary" icon="download" href={downloadResult.signedUrl} target="_blank">
                    Download
                  </s-button>
                </div>
                {downloadResult.expiresAt && (
                  <s-text color="subdued">
                    Link expires at {new Date(downloadResult.expiresAt).toLocaleTimeString()}.
                  </s-text>
                )}
              </div>
            )}

          </s-stack>
        </s-section>

      </s-stack>
    </s-page>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function capitalize(s) {
  // Title-case each underscore-separated word: "smart_collections" → "Smart Collections".
  return s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Capitalize only the first character (leaves the rest of the filename as-is).
function upperFirst(s) {
  const str = String(s ?? "");
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Display names that don't follow the default title-casing of the entity key.
const ENTITY_LABEL_OVERRIDES = {
  definitions: "Metafield definitions",
  inventory_transfers: "Inventory transfers",
  // Exports the full translatable-content template (every translatable field,
  // translated or not), so "Translatables" is more accurate than "Translations".
  translations: "Translatables",
};

/** Human label for an entity key — override first, else title-cased key. */
function entityDisplayName(e) {
  return ENTITY_LABEL_OVERRIDES[e] ?? capitalize(e);
}

/**
 * Rough client-side export-time estimate from the row count. Returns "—"
 * when the count is unavailable (e.g. articles).
 */
function estimateExport(rows) {
  if (rows == null) return "—";
  const secs = Math.max(2, Math.ceil(rows / 500));
  return secs < 60 ? `${secs} sec` : `${Math.ceil(secs / 60)} min`;
}

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
function PickerRow({ label, selected, onSelect, popoverId }) {
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
        <span style={selected ? { fontWeight: 700 } : undefined}>{label}</span>
      </s-grid>
    </s-clickable>
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
    };
  }
  return state;
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
function EntityConfigCard({ entity, state, count, dynGroups = EMPTY_DYN_GROUPS, onAddFilter, onUpdateFilter, onRemoveFilter, onToggleField, onSetFields, onRemove, disabled }) {
  const all = allFieldsFor(entity, dynGroups);
  const groups = groupsFor(entity, dynGroups);
  // Filter on the static columns only — the dynamic keys would bloat the
  // dropdown with a row per location/metafield/catalog.
  const columnOptions = (FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS).map((f) => ({ value: f, label: FIELD_LABELS[f] ?? f }));
  const [open, setOpen] = useState(false);
  const lock = disabled ? true : undefined;

  // Toggle every field in a group at once, preserving canonical column order.
  const setGroup = (fields, checked) => {
    const set = new Set(state.selectedFields);
    for (const f of fields) checked ? set.add(f) : set.delete(f);
    onSetFields(all.filter((f) => set.has(f)));
  };

  return (
    <s-section>
      <s-stack direction="block" gap="base">

        {/* Header: entity icon + name on the left; summary stats, an
            expand chevron, and a remove (✕) button on the right. */}
        <div style={cardHeader} onClick={() => setOpen((o) => !o)}>
          {ENTITY_ICONS[entity] && <s-icon type={ENTITY_ICONS[entity]} />}
          <span style={{ fontWeight: 700 }}>{entityDisplayName(entity)}</span>
          <div style={cardHeaderInfo}>
            <s-badge tone="success">{state.selectedFields.length} of {all.length} columns</s-badge>
            <s-badge>Total: {count != null ? count.toLocaleString() : "—"}</s-badge>
            <s-badge>Estimate: {estimateExport(count)}</s-badge>
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
          <>
            {/* Select Columns — comes first, like Matrixify */}
            <s-stack direction="block" gap="small-200">
              <span style={sectionHeader}>Select Columns</span>
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

            {/* Set Filters — dynamic builder: each row is column + condition +
                value + remove. "Add filter" appends a blank row. */}
            <s-stack direction="block" gap="small-200">
              <span style={sectionHeader}>Set Filters</span>
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
          </>
        )}

      </s-stack>
    </s-section>
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
const entityGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: ".4rem",
};
const twoColRow = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "start",
};
// Reserved left column in picker rows so the selected option's checkmark
// sits to the left and all labels stay aligned (Shopify single-select look).
const checkSlot = {
  width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const entityBox = {
  border: "1px solid #c9cccf", borderRadius: 6, padding: ".3rem .5rem",
  display: "flex", alignItems: "center", gap: ".3rem",
};
const entityLabel = {
  pointerEvents: "none", fontSize: ".8rem", whiteSpace: "nowrap",
};
const entityCount = {
  marginLeft: "auto", pointerEvents: "none",
  color: "#6d7175", fontSize: ".72rem", fontVariantNumeric: "tabular-nums",
};
const cardHeader = {
  display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer",
};
// The "file is ready" success box: bordered green card with a bold title and a
// primary download button, rather than a plain banner.
const downloadBox = {
  border: "1px solid #a6e0bf",
  background: "#f0faf5",
  borderRadius: 12,
  padding: "1.15rem 1.35rem",
  display: "flex",
  flexDirection: "column",
  gap: ".7rem",
};
const downloadHead = {
  display: "flex", alignItems: "center", gap: ".5rem",
};
// s-icon maxes out at the "base" size token, so scale it up a touch visually.
const downloadCheck = {
  display: "inline-flex", transform: "scale(1.35)", transformOrigin: "center",
};
const downloadTitle = {
  fontSize: "1.2rem", fontWeight: 700, color: "#0c5132", lineHeight: 1.2,
};
const downloadFileRow = {
  display: "flex", alignItems: "center", gap: ".4rem", flexWrap: "wrap",
};
// The filename set apart from the surrounding text: monospace, bold, dark.
const downloadFile = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontWeight: 600, fontSize: ".9rem", color: "#202223",
  wordBreak: "break-all",
};
const sectionHeader = {
  fontSize: ".78rem", fontWeight: 600, color: "#6d7175",
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
const cardHeaderInfo = {
  marginLeft: "auto", display: "flex", flexDirection: "row",
  alignItems: "center", gap: ".25rem",
};
