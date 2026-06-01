/**
 * app/routes/app.export.jsx
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

import { useState, useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { data } from "react-router";
import { authenticate }    from "../shopify.server.js";
import { runExportJob }    from "../export/exportJob.js";
import { getJob, getJobsForShop } from "../db/bulkExportJob.server.js";
import { FIELDS_BY_ENTITY, PRODUCT_FIELDS } from "../export/fieldLists.js";

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
    { key: "financialStatus", label: "Financial status", type: "select",
      options: opts(["paid", "pending", "refunded", "partially_refunded", "voided"]) },
    { key: "fulfillmentStatus", label: "Fulfillment status", type: "select",
      options: opts(["fulfilled", "unfulfilled", "partial"]) },
    { key: "tag", label: "Tag", type: "text" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
  ],
  customers: [
    { key: "state", label: "State", type: "select", options: opts(["enabled", "disabled", "invited", "declined"]) },
    { key: "email", label: "Email", type: "text", placeholder: "e.g. @gmail.com" },
    { key: "country", label: "Country", type: "text", placeholder: "e.g. Canada" },
    { key: "tag", label: "Tag", type: "text" },
    { key: "createdAtMin", label: "Created after", type: "date" },
    { key: "createdAtMax", label: "Created before", type: "date" },
  ],
  collections: [
    { key: "title", label: "Title", type: "text" },
    { key: "collectionType", label: "Type", type: "select", options: opts(["smart", "custom"]) },
    { key: "updatedAtMin", label: "Updated after", type: "date" },
    { key: "updatedAtMax", label: "Updated before", type: "date" },
  ],
  discounts: [
    { key: "status", label: "Status", type: "select", options: opts(["active", "expired", "scheduled"]) },
    { key: "title", label: "Title", type: "text" },
  ],
  pages:    contentFilters(),
  blogs:    contentFilters(),
  articles: contentFilters(),
};

function opts(values) {
  return values.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
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

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const url   = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  let polledJob = null;
  if (jobId) {
    const job = await getJob(jobId);
    if (!job) return data({ error: "Job not found" }, { status: 404 });
    polledJob = {
      jobId:     job.id,
      status:    job.status,
      signedUrl: job.signedUrl,
      filename:  `${job.entity}-export.${job.format}`,
      expiresAt: job.signedUrlExpiry?.toISOString() ?? null,
      rowCount:  job.rowCount,
      error:     job.errorMessage,
    };
  }

  const recent = await getJobsForShop(session.shop, 15);
  const recentJobs = recent.map((j) => ({
    id:        j.id,
    entity:    j.entity,
    format:    j.format,
    status:    j.status,
    rowCount:  j.rowCount,
    signedUrl: j.signedUrl,
    expiresAt: j.signedUrlExpiry?.toISOString() ?? null,
    createdAt: j.createdAt?.toISOString() ?? null,
    error:     j.errorMessage,
  }));

  return { polledJob, recentJobs };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const entity   = formData.get("entity") ?? "products";
  const format   = formData.get("format") ?? "csv";

  let filters = {};
  try { filters = JSON.parse(formData.get("filters") ?? "{}"); } catch { /* ignore */ }

  const fieldsRaw = formData.get("fields") ?? "";
  const fields = fieldsRaw ? fieldsRaw.split(",") : undefined;

  try {
    const result = await runExportJob({
      admin, shop: session.shop, entity, format, filters, fields,
    });

    if (result.mode === "direct") {
      return {
        mode: "direct",
        signedUrl: result.signedUrl,
        filename:  result.filename,
        expiresAt: result.expiresAt.toISOString(),
      };
    }
    return { mode: "bulk", jobId: result.jobId };
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const ENTITIES = ["products", "orders", "customers", "collections", "discounts", "pages", "blogs", "articles"];
const FORMATS  = ["csv", "excel", "xml", "json"];

const STATUS_TONE = {
  complete: "success",
  running:  "info",
  pending:  "info",
  failed:   "critical",
};

export default function ExportPage() {
  const { recentJobs } = useLoaderData();

  const [entity, setEntity] = useState("products");
  const [format, setFormat] = useState("csv");

  const availableFields = FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS;
  const filterDefs      = FILTERS_BY_ENTITY[entity] ?? [];

  const [filterValues, setFilterValues] = useState({});
  const [selectedFields, setSelectedFields] = useState(availableFields);

  function handleEntityChange(newEntity) {
    setEntity(newEntity);
    setSelectedFields(FIELDS_BY_ENTITY[newEntity] ?? PRODUCT_FIELDS);
    setFilterValues({});
  }

  function setFilter(key, value) {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleField(field) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  const fetcher     = useFetcher();
  const pollFetcher = useFetcher();
  const [pollingJobId, setPollingJobId] = useState(null);

  const isExporting = fetcher.state !== "idle";
  const result      = fetcher.data;

  useEffect(() => {
    if (result?.mode === "bulk" && result.jobId) setPollingJobId(result.jobId);
  }, [result]);

  useEffect(() => {
    if (!pollingJobId) return;
    const s = pollFetcher.data?.polledJob?.status;
    if (s === "complete" || s === "failed") return;
    const interval = setInterval(() => {
      pollFetcher.load(`/app/export?jobId=${pollingJobId}`);
    }, 3000);
    return () => clearInterval(interval);
  }, [pollingJobId, pollFetcher.data?.polledJob?.status, pollFetcher]);

  function handleExport() {
    setPollingJobId(null);

    const filters = {};
    for (const def of filterDefs) {
      const value = filterValues[def.key];
      if (value) filters[def.key] = value;
    }

    const formData = new FormData();
    formData.set("entity", entity);
    formData.set("format", format);
    formData.set("filters", JSON.stringify(filters));
    if (selectedFields.length !== availableFields.length) {
      formData.set("fields", selectedFields.join(","));
    }

    fetcher.submit(formData, { method: "post" });
  }

  // Resolve the file the user should see now:
  //   - direct mode returns inline,
  //   - bulk mode arrives later via the polling fetcher.
  const downloadResult = (() => {
    if (result?.mode === "direct") return result;
    if (pollFetcher.data?.polledJob?.status === "complete") return pollFetcher.data.polledJob;
    return null;
  })();

  const bulkError = pollFetcher.data?.polledJob?.status === "failed"
    ? pollFetcher.data.polledJob.error ?? "Export failed" : null;

  const isPolling = pollingJobId &&
    pollFetcher.data?.polledJob?.status !== "complete" &&
    pollFetcher.data?.polledJob?.status !== "failed";

  return (
    <s-page heading="Export">
      <s-stack direction="block" gap="base">

        {/* ── New export form ──────────────────────────────────────── */}
        <s-section heading="New export">
          <s-stack direction="block" gap="base">

            {/* Entity + format */}
            <div style={twoColGrid}>
              <label style={labelStyle}>
                <s-text type="strong">Entity</s-text>
                <select
                  value={entity}
                  onChange={(e) => handleEntityChange(e.target.value)}
                  style={selectStyle}
                  disabled={isExporting || isPolling}
                >
                  {ENTITIES.map((e) => (
                    <option key={e} value={e}>{capitalize(e)}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                <s-text type="strong">Format</s-text>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  style={selectStyle}
                  disabled={isExporting || isPolling}
                >
                  {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                </select>
              </label>
            </div>

            {/* Filters */}
            {filterDefs.length > 0 && (
              <details style={detailsStyle} open>
                <summary style={summaryStyle}>Filter rows</summary>
                <div style={filterGrid}>
                  {filterDefs.map((def) => (
                    <label key={def.key} style={labelStyle}>
                      <s-text type="strong">{def.label}</s-text>
                      {def.type === "select" ? (
                        <select
                          value={filterValues[def.key] ?? ""}
                          onChange={(e) => setFilter(def.key, e.target.value)}
                          style={selectStyle}
                        >
                          <option value="">Any</option>
                          {def.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={def.type === "date" ? "date" : "text"}
                          value={filterValues[def.key] ?? ""}
                          placeholder={def.placeholder ?? ""}
                          onChange={(e) => setFilter(def.key, e.target.value)}
                          style={inputStyle}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </details>
            )}

            {/* Columns */}
            <details style={detailsStyle}>
              <summary style={summaryStyle}>
                Columns ({selectedFields.length} of {availableFields.length})
              </summary>
              <div style={{ display: "flex", gap: ".5rem", margin: ".75rem 0" }}>
                <button type="button" onClick={() => setSelectedFields(availableFields)} style={smallBtn}>
                  Select all
                </button>
                <button type="button" onClick={() => setSelectedFields([])} style={smallBtn}>
                  Clear all
                </button>
              </div>
              <div style={columnsGrid}>
                {availableFields.map((field) => (
                  <label key={field} style={checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={selectedFields.includes(field)}
                      onChange={() => toggleField(field)}
                    />
                    {field}
                  </label>
                ))}
              </div>
            </details>

            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={handleExport}
                disabled={isExporting || isPolling || selectedFields.length === 0}
              >
                {isExporting ? "Starting export…" : "Export"}
              </s-button>
            </s-stack>

            {selectedFields.length === 0 && (
              <s-banner tone="warning">
                Select at least one column to export.
              </s-banner>
            )}

            {/* Errors */}
            {(result?.error || bulkError) && (
              <s-banner tone="critical">{result?.error ?? bulkError}</s-banner>
            )}

            {/* Bulk progress */}
            {isPolling && (
              <s-banner tone="info">
                <s-stack direction="block" gap="small-200">
                  <s-text>
                    Large store — Shopify is processing your export in the background.
                    This page updates automatically when it&apos;s ready.
                  </s-text>
                  <s-text color="subdued">
                    Status: {pollFetcher.data?.polledJob?.status ?? "pending"}
                    {pollFetcher.data?.polledJob?.rowCount
                      ? ` · ${pollFetcher.data.polledJob.rowCount.toLocaleString()} rows`
                      : ""}
                  </s-text>
                </s-stack>
              </s-banner>
            )}

            {/* Download */}
            {downloadResult?.signedUrl && (
              <s-banner tone="success">
                <s-stack direction="block" gap="small-200">
                  <s-text>Your file is ready:</s-text>
                  <s-link href={downloadResult.signedUrl} target="_blank">
                    {downloadResult.filename}
                    {downloadResult.rowCount ? ` (${downloadResult.rowCount.toLocaleString()} rows)` : ""}
                  </s-link>
                  {downloadResult.expiresAt && (
                    <s-text color="subdued">
                      Link expires at {new Date(downloadResult.expiresAt).toLocaleTimeString()}.
                    </s-text>
                  )}
                </s-stack>
              </s-banner>
            )}

          </s-stack>
        </s-section>

        {/* ── Recent exports ───────────────────────────────────────── */}
        <s-section heading="Recent exports">
          {recentJobs.length === 0 ? (
            <s-paragraph>No exports yet. Run one above to see it here.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Entity</s-table-header>
                <s-table-header>Format</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Rows</s-table-header>
                <s-table-header>Created</s-table-header>
                <s-table-header>File</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recentJobs.map((j) => (
                  <s-table-row key={j.id}>
                    <s-table-cell>{capitalize(j.entity)}</s-table-cell>
                    <s-table-cell>{j.format.toUpperCase()}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={STATUS_TONE[j.status] ?? "info"}>{j.status}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{j.rowCount?.toLocaleString() ?? "—"}</s-table-cell>
                    <s-table-cell>
                      {j.createdAt ? new Date(j.createdAt).toLocaleString() : "—"}
                    </s-table-cell>
                    <s-table-cell>
                      {j.status === "complete" && j.signedUrl && !isExpired(j.expiresAt) ? (
                        <s-link href={j.signedUrl} target="_blank">Download</s-link>
                      ) : j.status === "failed" ? (
                        <s-text color="subdued">{truncate(j.error, 40)}</s-text>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>

      </s-stack>
    </s-page>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isExpired(iso) {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// ─── styles (form inputs only; layout uses Polaris) ──────────────────────────

const labelStyle = {
  display: "flex", flexDirection: "column", gap: ".35rem",
};
const twoColGrid = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem",
};
const filterGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: ".75rem", marginTop: ".75rem",
};
const columnsGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: ".4rem",
};
const selectStyle = {
  padding: ".45rem .6rem", borderRadius: 6,
  border: "1px solid #c9cccf", fontSize: ".875rem", background: "#fff",
};
const inputStyle = { ...selectStyle };
const smallBtn = {
  padding: ".3rem .6rem", background: "#fff",
  border: "1px solid #c9cccf", borderRadius: 6,
  fontSize: ".8rem", cursor: "pointer",
};
const checkboxLabel = {
  display: "flex", alignItems: "center", gap: ".4rem",
  fontSize: ".85rem", cursor: "pointer",
};
const detailsStyle = {
  border: "1px solid #e1e3e5", borderRadius: 8, padding: ".5rem .9rem",
};
const summaryStyle = {
  cursor: "pointer", fontWeight: 600, fontSize: ".9rem", padding: ".25rem 0",
};
