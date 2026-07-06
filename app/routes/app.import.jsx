/**
 * app/routes/app.import.jsx
 *
 * The "New Import" page (/app/import), opened after a file is uploaded on the
 * home. The home stages the file to R2 and redirects here with `?src=<key>`;
 * this page downloads it, analyzes every sheet, and shows the per-sheet options.
 * Shows a "SyncifyPro > Import" breadcrumb + Back button, matching Export.
 *
 *   1. Options: pick/override each sheet's entity, untick sheets, see the intent.
 *   2. Import → enqueues a background job (the staged file is the source);
 *      the page polls it (`/app/import?jobId=…`) with a live progress bar.
 *   3. When it finishes, download the results workbook (per-row status/errors).
 */

import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { data, redirect } from "react-router";
import { authenticate } from "../shopify.server.js";
import { analyzeWorkbook } from "../import/importJob.js";

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  // Job-status polling (during/after an import).
  if (jobId) {
    const { getImportJob } = await import("../db/bulkImportJob.server.js");
    const found = await getImportJob(jobId);
    return { job: found && found.shop === session.shop ? serializeJob(found) : null, src: null, name: null, preview: null };
  }

  // A staged upload → download + analyze so we can show the options.
  const src = url.searchParams.get("src");
  const name = url.searchParams.get("name");
  if (!src) return redirect("/app");

  const { downloadFromR2 } = await import("../export/delivery/r2.js");
  const format = formatFromName(name || src) ?? "csv";
  const fileBuffer = await downloadFromR2(src);
  const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, filename: name });
  const preview = { filename: name || "import", format, sheets: sheets.map(stripValidRows), totals };
  return { job: null, src, name: name || "import", preview };
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    filename: job.filename,
    entity: job.entity,
    progressCurrent: job.progressCurrent ?? 0,
    progressTotal: job.progressTotal ?? null,
    created: job.created ?? 0,
    updated: job.updated ?? 0,
    deleted: job.deleted ?? 0,
    failed: job.failed ?? 0,
    resultUrl: job.resultUrl ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : null,
  };
}

// ─── Action (re-analyze with a plan / apply — both from the staged file) ────────

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const mode = formData.get("mode") ?? "analyze"; // "analyze" | "apply"
  const src = formData.get("src");
  const name = formData.get("name") || "import";
  const plan = parsePlan(formData.get("plan"));

  if (!src || typeof src !== "string") {
    return data({ error: "Missing file reference — start again from the home page." }, { status: 400 });
  }

  const format = formatFromName(name) ?? formatFromName(src) ?? "csv";

  try {
    const { downloadFromR2 } = await import("../export/delivery/r2.js");
    const fileBuffer = await downloadFromR2(src);

    if (mode === "analyze") {
      const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, plan, filename: name });
      const preview = { filename: name, format, sheets: sheets.map(stripValidRows), totals };
      return { mode: "analyze", preview };
    }

    // mode === "apply": enqueue a background job using the already-staged file.
    const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, plan, filename: name });
    if (totals.importable === 0) {
      return data({ error: "Nothing importable — no sheets selected or all rows invalid." }, { status: 400 });
    }

    const { createImportJob } = await import("../db/bulkImportJob.server.js");
    const { enqueueImport } = await import("../queue/importQueue.server.js");

    const entities = [...new Set(sheets.filter((s) => s.ok).map((s) => s.entity))].join(",");
    const job = await createImportJob({
      shop: session.shop,
      entity: entities,
      format,
      filename: name,
      sourceR2Key: src,
      progressTotal: totals.importable,
    });
    await enqueueImport({ jobId: job.id, shop: session.shop, plan });

    return { mode: "apply", jobId: job.id };
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

function parsePlan(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const plan = JSON.parse(raw);
    return Array.isArray(plan) ? plan : null;
  } catch {
    return null;
  }
}

function formatFromName(name) {
  const ext = String(name).toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  return null;
}

function stripValidRows(sheet) {
  const { validRows, ...rest } = sheet; // eslint-disable-line no-unused-vars
  return rest;
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

const ENTITY_OPTIONS = [
  { value: "auto",      label: "Auto-detect" },
  { value: "products",  label: "Products" },
  { value: "orders",    label: "Orders" },
  { value: "customers", label: "Customers" },
  { value: "redirects", label: "Redirects" },
  { value: "ignore",    label: "Ignore this sheet" },
];

export default function ImportPage() {
  const { src, name, preview: initialPreview } = useLoaderData();
  const fetcher = useFetcher();        // re-analyze / apply
  const pollFetcher = useFetcher();    // job status polling

  const [plan, setPlan] = useState(null);       // per-sheet {entity, include}, by index
  const [pollingJobId, setPollingJobId] = useState(null);

  const busy = fetcher.state !== "idle";
  const d = fetcher.data;
  // Latest analysis wins over the initial (loader) analysis.
  const preview = d?.mode === "analyze" ? d.preview : initialPreview;
  const error = d?.error;

  const job = pollFetcher.data?.job ?? null;
  const finished = job && (job.status === "complete" || job.status === "failed");

  // Initialise the plan once the first preview is available.
  useEffect(() => {
    if (preview && plan == null) {
      setPlan(preview.sheets.map((s) => ({
        entity: s.ok ? s.entity : "auto",
        include: Boolean(s.ok),
      })));
    }
  }, [preview, plan]);

  // When apply returns a jobId, start polling.
  useEffect(() => {
    if (d?.mode === "apply" && d.jobId) setPollingJobId(d.jobId);
  }, [d]);

  useEffect(() => {
    if (pollingJobId) pollFetcher.load(`/app/import?jobId=${pollingJobId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingJobId]);

  useEffect(() => {
    if (!pollingJobId) return;
    if (job?.status === "complete" || job?.status === "failed") return;
    const interval = setInterval(() => {
      pollFetcher.load(`/app/import?jobId=${pollingJobId}`);
    }, 2000);
    return () => clearInterval(interval);
  }, [pollingJobId, job?.status, pollFetcher]);

  function submit(mode, planArg) {
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("src", src ?? "");
    fd.set("name", name ?? "");
    if (planArg) fd.set("plan", JSON.stringify(planArg));
    fetcher.submit(fd, { method: "post" });
  }

  // A dropdown/checkbox change re-analyzes with the updated plan.
  function updatePlan(i, patch) {
    const next = plan.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setPlan(next);
    submit("analyze", next);
  }

  return (
    <s-page heading="Import">
      {/* Breadcrumb → "SyncifyPro > Import"; Back returns to the home. */}
      <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>
      <s-button slot="secondary-actions" variant="tertiary" icon="arrow-left" href="/app">Back</s-button>

      <s-stack direction="block" gap="base">

        {error && <s-banner tone="critical">{error}</s-banner>}

        {/* ── New Import: analysis + per-sheet plan ────────────────── */}
        {preview && !pollingJobId && (
          <s-section heading="New Import">
            <s-stack direction="block" gap="base">

              {/* Header details */}
              <div style={headerRow}>
                <s-stack direction="inline" gap="small" alignment="center">
                  <s-text type="strong">{preview.filename}</s-text>
                  <s-badge>{String(preview.format).toUpperCase()}</s-badge>
                  <s-badge tone={preview.totals.importable > 0 ? "success" : "warning"}>
                    {preview.totals.importable > 0 ? "Ready to import" : "Nothing to import"}
                  </s-badge>
                </s-stack>
                <s-button href="/app">Start over</s-button>
              </div>

              {/* Sheets */}
              <s-stack direction="block" gap="small">
                {preview.sheets.map((s, i) => (
                  <SheetCard
                    key={i}
                    sheet={s}
                    plan={plan?.[i] ?? { entity: "auto", include: true }}
                    onEntity={(entity) => updatePlan(i, { entity, include: entity !== "ignore" })}
                    onInclude={(include) => updatePlan(i, { include })}
                    disabled={busy}
                  />
                ))}
              </s-stack>

              {/* Totals + import */}
              <div style={statsGrid}>
                <Stat label="New" value={preview.totals.create} tone={preview.totals.create > 0 ? "success" : undefined} />
                <Stat label="Update" value={preview.totals.update} tone={preview.totals.update > 0 ? "info" : undefined} />
                <Stat label="Delete" value={preview.totals.delete} tone={preview.totals.delete > 0 ? "critical" : undefined} />
                <Stat label="Invalid" value={preview.totals.invalid} tone={preview.totals.invalid > 0 ? "critical" : undefined} />
              </div>

              <s-stack direction="inline" gap="small" alignment="center">
                <s-button
                  variant="primary"
                  onClick={() => submit("apply", plan)}
                  disabled={busy || preview.totals.importable === 0}
                >
                  {busy ? "Starting…" : `Import ${preview.totals.importable || ""}`.trim()}
                </s-button>
                {busy && <s-text color="subdued">Re-analyzing…</s-text>}
              </s-stack>
            </s-stack>
          </s-section>
        )}

        {/* ── Progress + results ───────────────────────────────────── */}
        {pollingJobId && (
          <s-section heading="Import">
            <s-stack direction="block" gap="base">

              {!finished && (() => {
                const cur = job?.progressCurrent ?? 0;
                const tot = job?.progressTotal ?? null;
                const pct = tot ? Math.min(100, Math.round((cur / tot) * 100)) : null;
                return (
                  <s-stack direction="block" gap="small-200">
                    <s-text>
                      {job?.status === "running" ? "Importing…" : "Queued…"}
                      {pct != null ? ` ${pct}% (${cur}/${tot})` : ""}
                    </s-text>
                    <div style={progressTrack} role="progressbar"
                      aria-valuemin={0} aria-valuemax={tot ?? undefined}
                      aria-valuenow={pct != null ? cur : undefined}>
                      <div style={{
                        ...progressFill,
                        width: pct != null ? `${pct}%` : "30%",
                        ...(pct == null ? { animation: "eg-indeterminate 1.2s ease-in-out infinite" } : {}),
                      }} />
                    </div>
                  </s-stack>
                );
              })()}

              {finished && job.status === "complete" && (
                <>
                  <div style={statsGrid}>
                    <Stat label="New" value={job.created} tone="success" />
                    <Stat label="Updated" value={job.updated} tone="success" />
                    <Stat label="Deleted" value={job.deleted} tone={job.deleted > 0 ? "critical" : undefined} />
                    <Stat label="Failed" value={job.failed} tone={job.failed > 0 ? "critical" : undefined} />
                  </div>
                  <s-banner tone={job.failed > 0 ? "warning" : "success"}>
                    Import finished{job.failed > 0 ? ` with ${job.failed} error${job.failed === 1 ? "" : "s"}` : ""}.
                  </s-banner>
                  <s-stack direction="inline" gap="small">
                    {job.resultUrl && (
                      <s-button variant="primary" href={job.resultUrl} target="_blank">
                        Download results
                      </s-button>
                    )}
                    <s-button href="/app">New import</s-button>
                  </s-stack>
                </>
              )}

              {finished && job.status === "failed" && (
                <>
                  <s-banner tone="critical">
                    Import failed: {job.errorMessage ?? "unknown error"}
                  </s-banner>
                  <s-stack direction="inline" gap="small">
                    <s-button href="/app">Try again</s-button>
                  </s-stack>
                </>
              )}
            </s-stack>
          </s-section>
        )}

      </s-stack>

      <style>{`
        @keyframes eg-indeterminate {
          0% { margin-left: 0%; width: 30%; }
          50% { margin-left: 70%; width: 30%; }
          100% { margin-left: 0%; width: 30%; }
        }
      `}</style>
    </s-page>
  );
}

// ─── components ──────────────────────────────────────────────────────────────

/* eslint-disable react/prop-types */
function SheetCard({ sheet, plan, onEntity, onInclude, disabled }) {
  const name = sheet.name ?? "Sheet";
  const included = plan.include && plan.entity !== "ignore";
  const columns = sheet.columns ?? [];
  const unknownCount = sheet.unknownColumns?.length ?? 0;

  return (
    <div style={{ ...sheetCard, opacity: included ? 1 : 0.6 }}>
      {/* Row 1: include + name + entity selector */}
      <div style={sheetHead}>
        <label style={{ display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={included}
            onChange={(e) => onInclude(e.target.checked)}
            disabled={disabled}
          />
          <s-text type="strong">{name}</s-text>
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          {sheet.detection?.via && sheet.ok && (
            <s-text color="subdued">detected by {sheet.detection.via}</s-text>
          )}
          <select
            value={plan.entity}
            onChange={(e) => onEntity(e.target.value)}
            style={entitySelect}
            disabled={disabled}
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: counts / status */}
      {included ? (
        sheet.ok ? (
          <div style={sheetMeta}>
            <s-text color="subdued">{sheet.parsed.toLocaleString()} items</s-text>
            <span style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
              {sheet.intent.create > 0 && <s-badge tone="success">{sheet.intent.create} new</s-badge>}
              {sheet.intent.update > 0 && <s-badge tone="info">{sheet.intent.update} update</s-badge>}
              {sheet.intent.delete > 0 && <s-badge tone="critical">{sheet.intent.delete} delete</s-badge>}
              {sheet.invalid > 0 && <s-badge tone="critical">{sheet.invalid} invalid</s-badge>}
            </span>
          </div>
        ) : (
          <div style={sheetMeta}>
            <s-badge tone="warning">Not importable</s-badge>
            <s-text color="subdued">{sheet.reason} Pick an entity or ignore this sheet.</s-text>
          </div>
        )
      ) : (
        <div style={sheetMeta}><s-text color="subdued">Ignored — won’t be imported.</s-text></div>
      )}

      {/* Row 3: columns with unknown flags */}
      {columns.length > 0 && (
        <details style={{ marginTop: ".5rem" }}>
          <summary style={summaryStyle}>
            {columns.length} columns
            {unknownCount > 0 && (
              <span style={{ color: "#b98900", marginLeft: ".4rem" }}>
                · {unknownCount} unrecognized
              </span>
            )}
          </summary>
          <div style={chipWrap}>
            {columns.map((c, i) => (
              <span key={i} style={c.known ? chip : chipUnknown} title={c.known ? "" : "Unrecognized column — imported as custom data"}>
                {!c.known && <span style={{ fontWeight: 700, marginRight: ".2rem" }}>!</span>}
                {c.name}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={statBox}>
      <s-text color="subdued">{label}</s-text>
      <s-text type="strong">
        {tone ? <s-badge tone={tone}>{value?.toLocaleString() ?? 0}</s-badge> : (value?.toLocaleString() ?? 0)}
      </s-text>
    </div>
  );
}
/* eslint-enable react/prop-types */

// ─── styles ──────────────────────────────────────────────────────────────────

const headerRow = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  gap: "1rem", flexWrap: "wrap",
  paddingBottom: ".75rem", borderBottom: "1px solid #e1e3e5",
};
const statsGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: ".75rem",
};
const statBox = {
  display: "flex", flexDirection: "column", gap: ".3rem",
  padding: ".75rem 1rem", border: "1px solid #e1e3e5", borderRadius: 8, background: "#fafbfb",
};
const sheetCard = {
  border: "1px solid #e1e3e5", borderRadius: 10, padding: ".85rem 1rem", background: "#fff",
};
const sheetHead = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  gap: "1rem", flexWrap: "wrap",
};
const sheetMeta = {
  display: "flex", alignItems: "center", gap: ".6rem", marginTop: ".5rem", flexWrap: "wrap",
};
const entitySelect = {
  padding: ".35rem .5rem", borderRadius: 6, border: "1px solid #c9cccf",
  fontSize: ".85rem", background: "#fff",
};
const summaryStyle = {
  cursor: "pointer", fontSize: ".82rem", color: "#6d7175", padding: ".2rem 0",
};
const chipWrap = {
  display: "flex", flexWrap: "wrap", gap: ".35rem", marginTop: ".5rem",
  maxHeight: 120, overflowY: "auto",
};
const chip = {
  fontSize: ".75rem", padding: ".15rem .5rem", borderRadius: 999,
  background: "#f1f2f3", color: "#42474c", whiteSpace: "nowrap",
};
const chipUnknown = {
  ...chip, background: "#fff4e4", color: "#8a6116", border: "1px solid #ffd79d",
};
const progressTrack = {
  width: "100%", height: 8, background: "#e3e5e7", borderRadius: 4, overflow: "hidden",
};
const progressFill = {
  height: "100%", borderRadius: 4, background: "#2c6ecb", transition: "width .3s ease",
};
