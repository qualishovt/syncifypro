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
import PolarisSelect from "../components/PolarisSelect.jsx";

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  // Job-status polling (during/after an import).
  if (jobId) {
    const { getImportJob } = await import("../db/bulkImportJob.server.js");
    const found = await getImportJob(jobId);
    return { job: found && found.shop === session.shop ? serializeJob(found) : null, src: null, name: null, preview: null, presets: [], defaultImportMode: "normal" };
  }

  // A staged upload → download + analyze so we can show the options.
  const src = url.searchParams.get("src");
  const name = url.searchParams.get("name");
  if (!src) return redirect("/app");

  const { downloadFromR2 } = await import("../export/delivery/r2.js");
  const { listImportPresets } = await import("../db/importPreset.server.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const format = formatFromName(name || src) ?? "csv";
  const fileBuffer = await downloadFromR2(src);
  const { defaultImportMode, blockedEntities } = await getAppSettings(session.shop);
  const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, filename: name, blockedEntities });
  const preview = { filename: name || "import", format, sheets: sheets.map(stripValidRows), totals };
  const presets = (await listImportPresets(session.shop)).map(serializePreset);
  return { job: null, src, name: name || "import", preview, presets, defaultImportMode };
}

function serializePreset(p) {
  return {
    id: p.id, name: p.name, format: p.format,
    plan: parseJsonOr(p.plan, []),
    options: parseJsonOr(p.options, null),
  };
}

function parseJsonOr(raw, fallback) {
  if (!raw || typeof raw !== "string") return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
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

  // Save / delete a named import preset (plan + mode). Handled before the
  // analyze/apply flow since these don't touch the staged file.
  const intent = formData.get("intent");
  if (intent === "savePreset" || intent === "deletePreset") {
    const preset = await import("../db/importPreset.server.js");
    try {
      if (intent === "deletePreset") {
        await preset.deleteImportPreset(session.shop, String(formData.get("presetId")));
        return { presetSaved: true };
      }
      const nm = String(formData.get("presetName") || "").trim();
      if (!nm) return data({ error: "Name the preset before saving." }, { status: 400 });
      await preset.saveImportPreset({
        shop: session.shop,
        name: nm,
        format: String(formData.get("format") || "csv"),
        plan: parsePlan(formData.get("plan")) ?? [],
        options: { mode: String(formData.get("importMode") || "normal") },
      });
      return { presetSaved: true, presetName: nm };
    } catch (err) {
      return data({ error: err.message }, { status: 500 });
    }
  }

  const mode = formData.get("mode") ?? "analyze"; // "analyze" | "apply"
  const src = formData.get("src");
  const name = formData.get("name") || "import";
  const plan = parsePlan(formData.get("plan"));
  const importMode = String(formData.get("importMode") || "normal");

  if (!src || typeof src !== "string") {
    return data({ error: "Missing file reference — start again from the home page." }, { status: 400 });
  }

  const format = formatFromName(name) ?? formatFromName(src) ?? "csv";

  try {
    const { downloadFromR2 } = await import("../export/delivery/r2.js");
    const { getAppSettings } = await import("../db/appSettings.server.js");
    const fileBuffer = await downloadFromR2(src);
    const { blockedEntities } = await getAppSettings(session.shop);

    if (mode === "analyze") {
      const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, plan, filename: name, blockedEntities });
      const preview = { filename: name, format, sheets: sheets.map(stripValidRows), totals };
      return { mode: "analyze", preview };
    }

    // mode === "apply": enqueue a background job using the already-staged file.
    const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, plan, filename: name, blockedEntities });
    if (totals.importable === 0) {
      return data({ error: "Nothing importable — no sheets selected or all rows invalid." }, { status: 400 });
    }

    const { createImportJob } = await import("../db/bulkImportJob.server.js");
    const { enqueueImport } = await import("../queue/importQueue.server.js");

    const entities = [...new Set(sheets.filter((s) => s.ok).map((s) => s.entity))].join(",");
    const options = { mode: importMode };
    const job = await createImportJob({
      shop: session.shop,
      entity: entities,
      format,
      filename: name,
      sourceR2Key: src,
      progressTotal: totals.importable,
      plan,      // persisted so Repeat/scheduling reuse the same per-sheet config
      options,
    });
    await enqueueImport({ jobId: job.id, shop: session.shop, plan, options });

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

// Row-filter conditions (must mirror matchesFilters in import/importJob.js).
const FILTER_OPS = [
  { value: "equals",       label: "Equals" },
  { value: "not_equal",    label: "Not equal" },
  { value: "contains",     label: "Contains" },
  { value: "not_contains", label: "Doesn't contain" },
  { value: "starts_with",  label: "Starts with" },
  { value: "is_empty",     label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
];
const VALUELESS_OPS = new Set(["is_empty", "is_not_empty"]);

export default function ImportPage() {
  const { src, name, preview: initialPreview, job: initialJob, presets: initialPresets, defaultImportMode } = useLoaderData();
  const fetcher = useFetcher();        // re-analyze / apply
  const pollFetcher = useFetcher();    // job status polling
  const presetFetcher = useFetcher();  // save / delete import presets

  const [plan, setPlan] = useState(null);       // per-sheet {entity, include}, by index
  const [importMode, setImportMode] = useState(defaultImportMode ?? "normal");
  const [pollingJobId, setPollingJobId] = useState(null);
  const [presetName, setPresetName] = useState("");
  const [presetId, setPresetId] = useState("");

  const presets = initialPresets ?? [];
  const busy = fetcher.state !== "idle";
  const presetBusy = presetFetcher.state !== "idle";
  const d = fetcher.data;
  // Latest analysis wins over the initial (loader) analysis.
  const preview = d?.mode === "analyze" ? d.preview : initialPreview;
  const error = d?.error || presetFetcher.data?.error;

  const job = pollFetcher.data?.job ?? initialJob ?? null;
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

  // Opened from a Recent-activity "#" link (/app/import?jobId=…) — show that job.
  useEffect(() => {
    if (initialJob?.id) setPollingJobId(initialJob.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    fd.set("importMode", importMode);
    fetcher.submit(fd, { method: "post" });
  }

  // A dropdown/checkbox change re-analyzes with the updated plan.
  function updatePlan(i, patch) {
    const next = plan.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setPlan(next);
    submit("analyze", next);
  }

  // Apply a saved preset: restore its plan + mode, then re-analyze the file so
  // counts/filters/columns reflect the loaded config.
  function applyPreset(id) {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const nextMode = p.options?.mode || "normal";
    setImportMode(nextMode);
    if (Array.isArray(p.plan) && p.plan.length) {
      setPlan(p.plan);
      const fd = new FormData();
      fd.set("mode", "analyze");
      fd.set("src", src ?? "");
      fd.set("name", name ?? "");
      fd.set("plan", JSON.stringify(p.plan));
      fd.set("importMode", nextMode);
      fetcher.submit(fd, { method: "post" });
    }
  }

  // Save the current per-sheet plan + mode as a named preset.
  function savePreset() {
    const nm = presetName.trim();
    if (!nm) return;
    const fd = new FormData();
    fd.set("intent", "savePreset");
    fd.set("presetName", nm);
    fd.set("format", preview?.format || "csv");
    fd.set("plan", JSON.stringify(plan ?? []));
    fd.set("importMode", importMode);
    presetFetcher.submit(fd, { method: "post" });
  }

  function deletePreset() {
    if (!presetId) return;
    presetFetcher.submit({ intent: "deletePreset", presetId }, { method: "post" });
    setPresetId("");
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
                    onFilters={(filters) => updatePlan(i, { filters })}
                    onColumns={(columns) => updatePlan(i, { columns })}
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

              {/* Import mode */}
              <div style={{ maxWidth: 320 }}>
                <PolarisSelect label="Import mode" value={importMode} onChange={setImportMode}>
                  <s-option value="normal">Normal — follow the Command column</s-option>
                  <s-option value="updateOnly">Update only — skip new records</s-option>
                  <s-option value="createOnly">Create only — skip existing records</s-option>
                  <s-option value="noDelete">Don&rsquo;t delete — ignore delete rows</s-option>
                  <s-option value="dryRun">Dry run — validate, write nothing</s-option>
                </PolarisSelect>
              </div>

              {/* Presets: reuse a saved plan + mode, or save the current one. */}
              <details style={{ ...presetBox }} open={presets.length > 0}>
                <summary style={summaryStyle}>
                  Presets{presets.length ? ` (${presets.length} saved)` : ""}
                </summary>
                <div style={{ marginTop: ".6rem", display: "flex", flexDirection: "column", gap: ".75rem" }}>
                  {presets.length > 0 && (
                    <div style={{ display: "flex", gap: ".5rem", alignItems: "end", flexWrap: "wrap" }}>
                      <PolarisSelect label="Apply a preset" value={presetId} onChange={applyPreset} disabled={busy || presetBusy}>
                        <s-option value="">Choose a preset…</s-option>
                        {presets.map((p) => (
                          <s-option key={p.id} value={p.id}>{p.name} ({String(p.format).toUpperCase()})</s-option>
                        ))}
                      </PolarisSelect>
                      {presetId && (
                        <s-button tone="critical" onClick={deletePreset} disabled={presetBusy}>Delete</s-button>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "end", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: ".2rem" }}>
                      <s-text type="strong">Save current setup as</s-text>
                      <input
                        style={filterInput}
                        value={presetName}
                        disabled={presetBusy}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="e.g. Weekly price update"
                      />
                    </label>
                    <s-button onClick={savePreset} disabled={presetBusy || !presetName.trim()} loading={presetBusy ? true : undefined}>
                      Save preset
                    </s-button>
                    {presetFetcher.data?.presetSaved && presetFetcher.data?.presetName && (
                      <s-text color="subdued">Saved “{presetFetcher.data.presetName}”.</s-text>
                    )}
                  </div>
                  <s-text color="subdued">Presets save the per-sheet plan (entity, filters, columns) and import mode. Pick one in the Scheduler to re-run it automatically.</s-text>
                </div>
              </details>

              <s-stack direction="inline" gap="small" alignment="center">
                <s-button
                  variant="primary"
                  onClick={() => submit("apply", plan)}
                  disabled={busy || preview.totals.importable === 0}
                >
                  {busy
                    ? "Starting…"
                    : (importMode === "dryRun" ? "Dry run" : `Import ${preview.totals.importable || ""}`.trim())}
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
function SheetCard({ sheet, plan, onEntity, onInclude, onFilters, onColumns, disabled }) {
  const name = sheet.name ?? "Sheet";
  const included = plan.include && plan.entity !== "ignore";
  const columns = sheet.columns ?? [];
  const unknownCount = sheet.unknownColumns?.length ?? 0;
  const filterCols = sheet.filterColumns ?? [];

  // Column selection lives in the plan as a list of selected keys; null means
  // "import every column". Toggling one off narrows what the writer touches.
  const allKeys = filterCols.map((c) => c.key);
  const selected = plan.columns ?? allKeys;
  const isSelected = (key) => selected.includes(key);
  const toggleColumn = (key) => {
    const next = isSelected(key) ? selected.filter((k) => k !== key) : [...selected, key];
    // Store null when everything is back on, so the plan stays "import all".
    onColumns(next.length === allKeys.length ? null : next);
  };
  const excludedCount = allKeys.length - selected.length;

  // Row filters live in the plan; edits re-analyze. Value typing updates locally
  // and re-analyzes on blur to avoid a request per keystroke.
  const [filters, setFilters] = useState(plan.filters ?? []);
  const apply = (next) => { setFilters(next); onFilters(next); };
  const change = (fi, patch, reanalyze) => {
    const next = filters.map((f, i) => (i === fi ? { ...f, ...patch } : f));
    reanalyze ? apply(next) : setFilters(next);
  };
  const addFilter = () => apply([...filters, { column: filterCols[0]?.key ?? "", operator: "equals", value: "" }]);
  const removeFilter = (fi) => apply(filters.filter((_, i) => i !== fi));

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
          <PolarisSelect
            label="Import as"
            value={plan.entity}
            onChange={(v) => onEntity(v)}
            disabled={disabled}
          >
            {ENTITY_OPTIONS.map((o) => (
              <s-option key={o.value} value={o.value}>{o.label}</s-option>
            ))}
          </PolarisSelect>
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

      {/* Row 3: columns — tick which ones to import (untick = leave field untouched) */}
      {columns.length > 0 && (
        <details style={{ marginTop: ".5rem" }} open={excludedCount > 0}>
          <summary style={summaryStyle}>
            {columns.length} columns
            {unknownCount > 0 && (
              <span style={{ color: "#b98900", marginLeft: ".4rem" }}>· {unknownCount} unrecognized</span>
            )}
            {excludedCount > 0 && (
              <span style={{ color: "#6d7175", marginLeft: ".4rem" }}>· {excludedCount} excluded</span>
            )}
          </summary>
          {included && sheet.ok ? (
            <div style={chipWrap}>
              {columns.map((c, i) => {
                const key = filterCols[i]?.key ?? c.name;
                const on = isSelected(key);
                return (
                  <label
                    key={i}
                    style={{ ...(c.known ? chip : chipUnknown), display: "flex", alignItems: "center", gap: ".3rem", cursor: "pointer", opacity: on ? 1 : 0.45 }}
                    title={c.known ? "" : "Unrecognized column — imported as custom data"}
                  >
                    <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggleColumn(key)} />
                    {!c.known && <span style={{ fontWeight: 700 }}>!</span>}
                    {c.name}
                  </label>
                );
              })}
            </div>
          ) : (
            <div style={chipWrap}>
              {columns.map((c, i) => (
                <span key={i} style={c.known ? chip : chipUnknown} title={c.known ? "" : "Unrecognized column — imported as custom data"}>
                  {!c.known && <span style={{ fontWeight: 700, marginRight: ".2rem" }}>!</span>}
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </details>
      )}

      {/* Row 4: row filters (only import records matching these conditions) */}
      {included && sheet.ok && filterCols.length > 0 && (
        <details style={{ marginTop: ".5rem" }} open={filters.length > 0}>
          <summary style={summaryStyle}>
            Row filters{filters.length ? ` (${filters.length})` : ""}
            {sheet.filteredOut > 0 && (
              <span style={{ color: "#6d7175", marginLeft: ".4rem" }}>· {sheet.filteredOut} rows excluded</span>
            )}
          </summary>
          <div style={{ marginTop: ".5rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
            {filters.map((f, fi) => (
              <div key={fi} style={filterRow}>
                <PolarisSelect label="Column" value={f.column} onChange={(v) => change(fi, { column: v }, true)} disabled={disabled}>
                  {filterCols.map((c) => <s-option key={c.key} value={c.key}>{c.label}</s-option>)}
                </PolarisSelect>
                <PolarisSelect label="Condition" value={f.operator} onChange={(v) => change(fi, { operator: v }, true)} disabled={disabled}>
                  {FILTER_OPS.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                </PolarisSelect>
                {!VALUELESS_OPS.has(f.operator) && (
                  <label style={{ display: "flex", flexDirection: "column", gap: ".2rem" }}>
                    <s-text type="strong">Value</s-text>
                    <input
                      style={filterInput}
                      value={f.value}
                      disabled={disabled}
                      onChange={(e) => change(fi, { value: e.target.value }, false)}
                      onBlur={() => onFilters(filters)}
                      placeholder="value"
                    />
                  </label>
                )}
                <s-button onClick={() => removeFilter(fi)} disabled={disabled}>Remove</s-button>
              </div>
            ))}
            <div><s-button onClick={addFilter} disabled={disabled}>Add filter</s-button></div>
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
const summaryStyle = {
  cursor: "pointer", fontSize: ".82rem", color: "#6d7175", padding: ".2rem 0",
};
const presetBox = { border: "1px solid #e1e3e5", borderRadius: 10, padding: ".75rem 1rem", background: "#fafbfb" };
const filterRow = { display: "flex", gap: ".5rem", alignItems: "end", flexWrap: "wrap" };
const filterInput = {
  padding: ".35rem .5rem", borderRadius: 6, border: "1px solid #c9cccf",
  fontSize: ".85rem", background: "#fff",
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
