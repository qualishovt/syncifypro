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

import { useState, useEffect, useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import { runExportJob, runMultiEntityExport } from "../export/exportJob.js";
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
    {
      key: "financialStatus", label: "Financial status", type: "select",
      options: opts(["paid", "pending", "refunded", "partially_refunded", "voided"])
    },
    {
      key: "fulfillmentStatus", label: "Fulfillment status", type: "select",
      options: opts(["fulfilled", "unfulfilled", "partial"])
    },
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
  pages: contentFilters(),
  blogs: contentFilters(),
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

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  let polledJob = null;
  if (jobId) {
    const job = await getJob(jobId);
    if (!job) return data({ error: "Job not found" }, { status: 404 });
    polledJob = {
      jobId: job.id,
      status: job.status,
      signedUrl: job.signedUrl,
      filename: `${job.entity}-export.${job.format}`,
      expiresAt: job.signedUrlExpiry?.toISOString() ?? null,
      rowCount: job.rowCount,
      error: job.errorMessage,
    };
  }

  const recent = await getJobsForShop(session.shop, 15);
  const recentJobs = recent.map((j) => ({
    id: j.id,
    entity: j.entity,
    format: j.format,
    status: j.status,
    rowCount: j.rowCount,
    signedUrl: j.signedUrl,
    expiresAt: j.signedUrlExpiry?.toISOString() ?? null,
    createdAt: j.createdAt?.toISOString() ?? null,
    error: j.errorMessage,
  }));

  return { polledJob, recentJobs };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const format = formData.get("format") ?? "csv";

  // Per-entity specs: [{ entity, filters?, fields? }, …]
  let specs = [];
  try { specs = JSON.parse(formData.get("specs") ?? "[]"); } catch { /* ignore */ }

  if (!Array.isArray(specs) || specs.length === 0) {
    return data({ error: "Select at least one entity to export." }, { status: 400 });
  }

  try {
    let result;
    if (specs.length === 1) {
      // Single-entity path preserves the bulk auto-switch for big stores.
      const s = specs[0];
      result = await runExportJob({
        admin, shop: session.shop,
        entity: s.entity,
        format,
        filters: s.filters ?? {},
        fields: s.fields,
      });
    } else {
      result = await runMultiEntityExport({
        admin, shop: session.shop, specs, format,
      });
    }

    if (result.mode === "direct") {
      return {
        mode: "direct",
        signedUrl: result.signedUrl,
        filename: result.filename,
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
const FORMATS = ["csv", "excel", "xml", "json"];

const STATUS_TONE = {
  complete: "success",
  running: "info",
  pending: "info",
  failed: "critical",
};

export default function ExportPage() {
  const { recentJobs } = useLoaderData();

  const [format, setFormat] = useState("csv");

  // Per-entity state: { enabled, filters: {key→value}, selectedFields: string[] }
  const [entityState, setEntityState] = useState(() => initialEntityState());

  const enabledEntities = ENTITIES.filter((e) => entityState[e].enabled);

  function setEntityEnabled(key, value) {
    setEntityState((prev) => ({ ...prev, [key]: { ...prev[key], enabled: value } }));
  }
  function setEntityFilter(key, filterKey, value) {
    setEntityState((prev) => ({
      ...prev,
      [key]: { ...prev[key], filters: { ...prev[key].filters, [filterKey]: value } },
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

  // Keep the format popover's width in sync with its full-width trigger
  // button. s-popover has no "match trigger" option, so we measure the
  // trigger and feed its pixel width into the popover's inlineSize.
  const formatTriggerRef = useRef(null);
  const [formatTriggerWidth, setFormatTriggerWidth] = useState(null);
  useEffect(() => {
    const el = formatTriggerRef.current;
    if (!el) return;
    const update = () => setFormatTriggerWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isExporting = fetcher.state !== "idle";
  const result = fetcher.data;

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

    // Build one spec per enabled entity. We omit `fields` when the user
    // hasn't deselected anything (so the backend uses defaults / all).
    const specs = enabledEntities.map((e) => {
      const s = entityState[e];
      const all = FIELDS_BY_ENTITY[e] ?? PRODUCT_FIELDS;
      const defs = FILTERS_BY_ENTITY[e] ?? [];

      const filters = {};
      for (const def of defs) {
        const value = s.filters[def.key];
        if (value) filters[def.key] = value;
      }

      const fields = s.selectedFields.length === all.length
        ? undefined
        : s.selectedFields;

      return { entity: e, filters, fields };
    });

    const formData = new FormData();
    formData.set("format", format);
    formData.set("specs", JSON.stringify(specs));

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

  // Allow export when at least one entity is ticked and each ticked entity
  // still has at least one column selected.
  const canSubmit =
    enabledEntities.length > 0 &&
    enabledEntities.every((e) => entityState[e].selectedFields.length > 0) &&
    !isExporting && !isPolling;

  return (
    <s-page heading="Export">
      <s-stack direction="block" gap="base">

        {/* ── Entities card ────────────────────────────────────────── */}
        <s-section heading="Entities to export">
          <s-stack direction="block" gap="base">
            <div style={entityGrid}>
              {ENTITIES.map((e) => (
                <div key={e} style={entityBox}>
                  <PolarisCheckbox
                    label={capitalize(e)}
                    checked={entityState[e].enabled}
                    onChange={(v) => setEntityEnabled(e, v)}
                    disabled={isExporting || isPolling}
                  />
                </div>
              ))}
            </div>

            {enabledEntities.length === 0 && (
              <s-banner tone="info">
                Tick one or more entities above. Each ticked entity gets its own
                filter + column card below.
              </s-banner>
            )}
          </s-stack>
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
              border="base"
              borderRadius="base"
              paddingInline="small-100"
              paddingBlock="small-300"
              background="base"
            >
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                <span style={{ fontWeight: 700 }}>{format.toUpperCase()}</span>
                <s-icon type="chevron-down" />
              </s-grid>
            </s-clickable>
          </div>
          <s-popover
            id="format-popover"
            inlineSize={formatTriggerWidth ? `${formatTriggerWidth}px` : "auto"}
          >
            <s-box padding="small-200">
              <s-stack direction="block" gap="small-300">
                {FORMATS.map((f) => {
                  const selected = format === f;
                  return (
                    <s-clickable
                      key={f}
                      onClick={() => setFormat(f)}
                      command="--hide"
                      commandFor="format-popover"
                      padding="small-200"
                      borderRadius="base"
                      {...(selected ? { background: "subdued" } : {})}
                    >
                      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                        <span style={{ fontWeight: selected ? 700 : 400 }}>{f.toUpperCase()}</span>
                        {selected ? <s-icon type="check" /> : <s-box />}
                      </s-grid>
                    </s-clickable>
                  );
                })}
              </s-stack>
            </s-box>
          </s-popover>
        </s-section>

        {/* One configuration card per enabled entity */}
        {enabledEntities.map((e) => (
          <EntityConfigCard
            key={e}
            entity={e}
            state={entityState[e]}
            onFilter={(k, v) => setEntityFilter(e, k, v)}
            onToggleField={(f) => toggleEntityField(e, f)}
            onSetFields={(fields) => setEntityFields(e, fields)}
            disabled={isExporting || isPolling}
          />
        ))}

        {/* Submit */}
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small">
              <button
                type="button"
                onClick={handleExport}
                disabled={!canSubmit}
                style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
              >
                {isExporting ? "Starting export…" : "Export"}
              </button>
              <s-text color="subdued">
                {enabledEntities.length === 0
                  ? "No entities selected."
                  : `${enabledEntities.length} entit${enabledEntities.length === 1 ? "y" : "ies"} selected.`
                }
              </s-text>
            </s-stack>

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

function initialEntityState() {
  const state = {};
  for (const e of ENTITIES) {
    state[e] = {
      enabled: false,
      filters: {},
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
function PolarisCheckbox({ label, checked, onChange, disabled }) {
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
      {...(checked ? { checked: true } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}

/**
 * Filter + column configuration card for one enabled entity.
 * Mirrors the existing single-entity controls but keyed on a per-entity
 * state slice provided by the parent.
 */
function EntityConfigCard({ entity, state, onFilter, onToggleField, onSetFields, disabled }) {
  const all = FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS;
  const filters = FILTERS_BY_ENTITY[entity] ?? [];

  return (
    <s-section heading={capitalize(entity)}>
      <s-stack direction="block" gap="base">

        {/* Filters */}
        {filters.length > 0 && (
          <details style={detailsStyle} open>
            <summary style={summaryStyle}>Filter rows</summary>
            <div style={filterGrid}>
              {filters.map((def) => (
                <label key={def.key} style={labelStyle}>
                  <s-text type="strong">{def.label}</s-text>
                  {def.type === "select" ? (
                    <select
                      value={state.filters[def.key] ?? ""}
                      onChange={(e) => onFilter(def.key, e.target.value)}
                      style={selectStyle}
                      disabled={disabled}
                    >
                      <option value="">Any</option>
                      {def.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={def.type === "date" ? "date" : "text"}
                      value={state.filters[def.key] ?? ""}
                      placeholder={def.placeholder ?? ""}
                      onChange={(e) => onFilter(def.key, e.target.value)}
                      style={inputStyle}
                      disabled={disabled}
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
            Columns ({state.selectedFields.length} of {all.length})
          </summary>
          <div style={{ display: "flex", gap: ".5rem", margin: ".75rem 0" }}>
            <button type="button" onClick={() => onSetFields([...all])} style={smallBtn} disabled={disabled}>
              Select all
            </button>
            <button type="button" onClick={() => onSetFields([])} style={smallBtn} disabled={disabled}>
              Clear all
            </button>
          </div>
          <div style={columnsGrid}>
            {all.map((field) => (
              <label key={field} style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={state.selectedFields.includes(field)}
                  onChange={() => onToggleField(field)}
                  disabled={disabled}
                />
                {field}
              </label>
            ))}
          </div>
        </details>

        {state.selectedFields.length === 0 && (
          <s-banner tone="warning">
            Select at least one column for {capitalize(entity)} or untick the entity above.
          </s-banner>
        )}

      </s-stack>
    </s-section>
  );
}
/* eslint-enable react/prop-types */

// ─── styles (form inputs only; layout uses Polaris) ──────────────────────────

const labelStyle = {
  display: "flex", flexDirection: "column", gap: ".35rem",
};
const filterGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: ".75rem", marginTop: ".75rem",
};
const entityGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: ".5rem",
};
const entityBox = {
  border: "1px solid #c9cccf", borderRadius: 8, padding: ".5rem .65rem",
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
const primaryBtn = {
  padding: ".55rem 1.1rem", background: "#000", color: "#fff",
  border: "none", borderRadius: 8,
  fontSize: ".9rem", fontWeight: 500,
};
