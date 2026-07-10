/**
 * app/routes/app._index.jsx
 *
 * The app's home page (/app): an Export entry card, an Import dropzone, and a
 * combined "Recent activity" table (imports + exports).
 *
 * Dropping/adding a file on the Import card STAGES it to R2 and redirects to the
 * New Import page (/app/import?src=…), where the per-sheet options are shown —
 * so the options open on their own page instead of appearing under the home.
 */

/* global Buffer */
import { useRef, useState } from "react";
import { useLoaderData, useFetcher, useNavigate, useNavigation } from "react-router";
import { data, redirect } from "react-router";
import { authenticate } from "../shopify.server.js";

// ─── Loader (combined recent activity) ─────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const { getImportJobsForShop } = await import("../db/bulkImportJob.server.js");
  const { getJobsForShop } = await import("../db/bulkExportJob.server.js");
  const { signDownloadUrl } = await import("../export/delivery/r2.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");

  // One combined "Recent activity" list (imports + exports), newest first.
  const [imports, exports] = await Promise.all([
    getImportJobsForShop(session.shop, 8),
    getJobsForShop(session.shop, 8),
  ]);
  const merged = [...imports.map(importMeta), ...exports.map(exportMeta)]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 10);
  // Re-sign a fresh download URL for the visible rows (stored URLs expire in ~1h;
  // the underlying R2 files are kept ~7 days).
  const recentActivity = await Promise.all(merged.map((row) => attachDownload(row, signDownloadUrl)));
  const { timezone } = await getAppSettings(session.shop);

  return { recentActivity, timezone };
}

// ─── Action (stage the uploaded file, then open the New Import page) ────────────

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();

  // Repeat a past job → new job from its stored config / staged file.
  if (formData.get("intent") === "repeat") {
    const type = formData.get("type");
    const jobId = String(formData.get("jobId") ?? "");
    if (type === "export") return repeatExport(admin, shop, jobId);
    if (type === "import") return repeatImport(shop, jobId);
    return data({ error: "Nothing to repeat." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return data({ error: "No file uploaded." }, { status: 400 });
  }
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
    return data({ error: "Unsupported file type. Upload a .csv or .xlsx file." }, { status: 400 });
  }

  const { putToR2 } = await import("../export/delivery/r2.js");
  const buffer = Buffer.from(await file.arrayBuffer());
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = String(file.name).replace(/[^\w.-]+/g, "_");
  const key = `imports/${session.shop}/${stamp}-${safeName}`;
  const mimeType = /\.csv$/i.test(file.name) ? "text/csv" : XLSX_MIME;

  await putToR2({ buffer, key, mimeType });

  // Hand off to the New Import page, which analyzes the staged file and shows
  // the per-sheet options.
  return redirect(`/app/import?src=${encodeURIComponent(key)}&name=${encodeURIComponent(file.name)}`);
}

// Re-run a past export from its stored spec (entities + filters + columns).
/** Parse a JSON column back to a value; null on absence or bad JSON. */
function parseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function repeatExport(admin, shop, jobId) {
  const { getJob } = await import("../db/bulkExportJob.server.js");
  const { startExport } = await import("../export/exportJob.js");
  const job = await getJob(jobId);
  if (!job || job.shop !== shop) return data({ error: "Export not found." }, { status: 404 });
  const specs = job.spec
    ? JSON.parse(job.spec)
    : [{ entity: job.entity, filters: {}, fields: job.fields ? job.fields.split(",") : undefined }];
  const res = await startExport({ admin, shop, specs, format: job.format });
  return redirect(`/app/export?jobId=${res.jobId}`);
}

// Re-run a past import from its still-staged uploaded file, reusing the plan +
// mode it ran with (per-sheet entity/filters/columns), so a Repeat reproduces
// the original run instead of re-detecting everything.
async function repeatImport(shop, jobId) {
  const { getImportJob, createImportJob } = await import("../db/bulkImportJob.server.js");
  const { enqueueImport } = await import("../queue/importQueue.server.js");
  const job = await getImportJob(jobId);
  if (!job || job.shop !== shop) return data({ error: "Import not found." }, { status: 404 });
  if (!job.sourceR2Key) return data({ error: "The original file is no longer available to repeat." }, { status: 400 });
  const plan = parseJson(job.plan);
  const options = parseJson(job.options);
  const newJob = await createImportJob({
    shop, entity: job.entity, format: job.format, filename: job.filename,
    sourceR2Key: job.sourceR2Key, progressTotal: job.progressTotal ?? null,
    plan, options,
  });
  await enqueueImport({ jobId: newJob.id, shop, plan, options: options ?? {} });
  return redirect(`/app/import?jobId=${newJob.id}`);
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const stripExt = (name) => String(name ?? "").replace(/\.[^.]+$/, "");
// A Recent-activity row's "#" links to that job's page (progress / downloads).
const jobHref = (j) => (j.type === "export" ? `/app/export?jobId=${j.id}` : `/app/import?jobId=${j.id}`);

function importMeta(j) {
  const base = (j.filename ? stripExt(j.filename) : titleCaseList(j.entity)) || "import";
  // Matrixify shows both the uploaded file AND the import-results file.
  const files = [];
  if (j.sourceR2Key) files.push({ key: j.sourceR2Key, name: j.filename || `${base}.${j.format}` });
  if (j.status === "complete" && j.resultR2Key) files.push({ key: j.resultR2Key, name: "Import result.xlsx" });
  return {
    id: j.id, type: "import",
    number: j.number ?? null,
    name: base, // shown without extension: "Products", not "Products.csv"
    format: j.format, status: j.status,
    progressCurrent: j.progressCurrent ?? 0, progressTotal: j.progressTotal ?? null,
    created: j.created ?? 0, updated: j.updated ?? 0, deleted: j.deleted ?? 0, failed: j.failed ?? 0,
    rowCount: null,
    createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
    errorMessage: j.errorMessage ?? null,
    _files: files,
  };
}

function exportMeta(j) {
  // The real file name is the R2 object's basename (e.g. products-2026-07-03.csv).
  const files = [];
  if (j.status === "complete" && j.r2Key) files.push({ key: j.r2Key, name: j.r2Key.split("/").pop() });
  return {
    id: j.id, type: "export",
    number: j.number ?? null,
    name: j.filename || titleCaseList(j.entity),
    format: j.format, status: j.status,
    progressCurrent: j.progressCurrent ?? 0, progressTotal: j.progressTotal ?? null,
    created: 0, updated: 0, deleted: 0, failed: 0,
    rowCount: j.rowCount ?? null,
    createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
    errorMessage: j.errorMessage ?? null,
    _files: files,
  };
}

// Re-sign a fresh download URL for each retained R2 file (stored URLs expire in
// ~1h; the underlying objects are kept ~7 days).
async function attachDownload(row, sign) {
  const { _files, ...rest } = row;
  const files = [];
  for (const f of _files ?? []) {
    try {
      const { signedUrl } = await sign(f.key, f.name);
      files.push({ url: signedUrl, name: f.name });
    } catch { /* skip a file we can't sign */ }
  }
  return { ...rest, files };
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

export default function Home() {
  const { recentActivity, timezone } = useLoaderData();
  const stageFetcher = useFetcher(); // stages the upload → redirects to /app/import
  const repeatFetcher = useFetcher(); // re-runs a past job → redirects to its page
  const navigate = useNavigate();
  const nav = useNavigation();
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // The row currently being repeated (for a per-row spinner).
  const repeatingId = repeatFetcher.state !== "idle" ? repeatFetcher.formData?.get("jobId") : null;
  function repeatJob(j) {
    repeatFetcher.submit({ intent: "repeat", type: j.type, jobId: j.id }, { method: "post" });
  }

  // The export page's loader is heavy — show a spinner on the button while its
  // navigation is in flight. Scoped to /app/export so it doesn't affect Import.
  const goingToExport = nav.state !== "idle" && nav.location?.pathname === "/app/export";

  // Only this fetcher's own submission — NOT unrelated navigations like the
  // "New Export" link — drives the uploading state.
  const uploading = stageFetcher.state !== "idle";

  function stageFile(f) {
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    stageFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }
  const openPicker = () => { if (!uploading) fileInputRef.current?.click(); };
  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    if (!uploading) stageFile(e.dataTransfer.files?.[0] ?? null);
  }

  return (
    <s-page heading="SyncifyPro">
      <s-stack direction="block" gap="base">

        {/* ── Export card ──────────────────────────────────────────── */}
        <s-section>
          <s-stack direction="block" gap="small">
            <div style={cardHeaderRow}>
              <ExportIcon />
              <span style={cardTitle}>Export</span>
            </div>
            <s-text color="subdued">
              Export products, orders, customers and more to Excel, CSV, JSON or XML.
            </s-text>
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                loading={goingToExport ? true : undefined}
                onClick={() => navigate("/app/export")}
              >
                New export
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>

        {/* ── Import card: dropzone → stages + opens the New Import page ── */}
        <s-section>
          <s-stack direction="block" gap="small">
            <div style={cardHeaderRow}>
              <ImportIcon />
              <span style={cardTitle}>Import</span>
            </div>
            <div
              className={dragActive ? "dz drag" : "dz"}
              role="button"
              tabIndex={0}
              onClick={openPicker}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => stageFile(e.target.files?.[0] ?? null)}
                onClick={(e) => e.stopPropagation()}
                style={{ display: "none" }}
              />
              <s-button variant="primary" disabled={uploading} onClick={(e) => { e.stopPropagation(); openPicker(); }}>
                {uploading ? "Uploading…" : "Add file"}
              </s-button>
              <s-text type="strong">or drop file here to upload</s-text>
              <s-text color="subdued">
                Excel (.xlsx) or CSV. An Excel workbook can hold one sheet per entity
                (Products, Customers, Orders…) — all imported in one job.
              </s-text>
            </div>
            {stageFetcher.data?.error && <s-banner tone="critical">{stageFetcher.data.error}</s-banner>}
          </s-stack>
        </s-section>

        {/* ── Recent activity: combined imports + exports ──────────── */}
        {recentActivity.length > 0 && (
          <s-section heading="Recent activity">
            <s-table>
              <s-table-header-row>
                <s-table-header>#</s-table-header>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header>Format</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Result</s-table-header>
                <s-table-header>Started</s-table-header>
                <s-table-header>Duration</s-table-header>
                <s-table-header>File</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recentActivity.map((j) => {
                  const st = statusInfo(j);
                  return (
                    <s-table-row key={j.id}>
                      <s-table-cell>
                        {j.number != null
                          ? <s-link href={jobHref(j)}>{`#${j.number}`}</s-link>
                          : <s-text color="subdued">—</s-text>}
                      </s-table-cell>
                      <s-table-cell>
                        <s-tooltip id={`type-${j.id}`}>{j.type === "export" ? "Export" : "Import"}</s-tooltip>
                        <span style={activityName}>
                          <s-text interestFor={`type-${j.id}`}>
                            <span style={activityIcon}>
                              {j.type === "export" ? <ExportIcon /> : <ImportIcon />}
                            </span>
                          </s-text>
                          {j.type === "export" ? "Export" : "Import"} {j.name}
                        </span>
                      </s-table-cell>
                      <s-table-cell>{String(j.format).toUpperCase()}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={st.tone ?? undefined}>{st.label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{resultText(j)}</s-table-cell>
                      <s-table-cell>{shortDateTime(j.createdAt, timezone)}</s-table-cell>
                      <s-table-cell>{duration(j.createdAt, j.completedAt)}</s-table-cell>
                      <s-table-cell>
                        {j.files?.length
                          ? (
                            <span style={fileList}>
                              {j.files.map((f, i) => (
                                <s-link key={i} href={f.url} target="_blank">{f.name}</s-link>
                              ))}
                            </span>
                          )
                          : <s-text color="subdued">—</s-text>}
                      </s-table-cell>
                      <s-table-cell>
                        <s-tooltip id={`repeat-${j.id}`}>Repeat</s-tooltip>
                        <s-button
                          interestFor={`repeat-${j.id}`}
                          variant="secondary"
                          icon="reset"
                          accessibilityLabel="Repeat"
                          loading={repeatingId === j.id ? true : undefined}
                          disabled={Boolean(repeatingId) && repeatingId !== j.id ? true : undefined}
                          onClick={() => repeatJob(j)}
                        />
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-section>
        )}

      </s-stack>

      <style>{`
        /* Dropzone: click anywhere in the box to pick, or drop a file on it. */
        .dz {
          display: flex; flex-direction: column; align-items: center; gap: .75rem;
          text-align: center; padding: 2.5rem 1.5rem;
          border: 2px dashed #c9cccf; border-radius: 12px; background: #fafbfb;
          cursor: pointer; transition: background .15s ease, border-color .15s ease;
        }
        .dz:hover, .dz.drag { background: #f1f2f3; border-color: #8c9196; }
        .dz:focus-visible { outline: 2px solid #005bd3; outline-offset: 2px; }
      `}</style>
    </s-page>
  );
}

// ─── components ──────────────────────────────────────────────────────────────

// Export = data leaving the store — green "out of a box" arrow (distinct shape
// AND colour from Import, so the two are easy to tell apart even when small).
// Polaris export icon, kept green via the success tone (s-icon can't take a
// raw hex — #008060 is Shopify's success green).
function ExportIcon() {
  return <s-icon type="export" tone="success" />;
}

// Import = data coming into the store — blue download-into-tray arrow.
function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: "1em", height: "1em" }} fill="none" stroke="#2c6ecb" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_TONE = { complete: "success", failed: "critical", running: "info", pending: "info" };
const STATUS_LABEL = { complete: "Complete", failed: "Failed", running: "Running", pending: "Queued" };

// Status label + tone. A *completed* import can still have per-record failures
// (the job "finished" but records errored) — so reflect that instead of a plain
// green "Complete". Running/queued jobs show a live progress %.
function statusInfo(j) {
  if (j.status === "complete" && j.type === "import") {
    const ok = (j.created ?? 0) + (j.updated ?? 0) + (j.deleted ?? 0);
    const failed = j.failed ?? 0;
    if (failed > 0 && ok === 0) return { label: "Failed", tone: "critical" };
    if (failed > 0) return { label: `Completed, ${failed} failed`, tone: "warning" };
  }
  const label = STATUS_LABEL[j.status] ?? j.status;
  const tone = STATUS_TONE[j.status];
  if ((j.status === "running" || j.status === "pending") && j.progressTotal) {
    const pct = Math.min(100, Math.round(((j.progressCurrent ?? 0) / j.progressTotal) * 100));
    return { label: `${label} · ${pct}%`, tone };
  }
  return { label, tone };
}

// Outcome summary: exports show rows; imports show new/updated/deleted (+ failed).
function resultText(j) {
  if (j.type === "export") return j.rowCount != null ? `${j.rowCount.toLocaleString()} rows` : "—";
  if (j.status !== "complete") return "—";
  const parts = [`${j.created} new`, `${j.updated} updated`, `${j.deleted} deleted`];
  if (j.failed) parts.push(`${j.failed} failed`);
  return parts.join(" · ");
}

// Rendered in the shop's chosen display time zone (Settings → Time zone),
// defaulting to UTC.
function shortDateTime(isoStr, tz = "UTC") {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: tz || "UTC", timeZoneName: "short",
  });
}

function duration(startIso, endIso) {
  if (!startIso || !endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function titleCaseList(csv) {
  return String(csv ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(", ");
}

// ─── styles ──────────────────────────────────────────────────────────────────

const cardHeaderRow = { display: "flex", alignItems: "center", gap: ".45rem", fontSize: "1rem" };
const cardTitle = { fontWeight: 600, color: "#303030" };
// Recent-activity Name cell: import/export icon + bold name.
const activityName = { display: "inline-flex", alignItems: "center", gap: ".4rem", fontWeight: 600 };
// Enlarge the icon (it's sized in em, so bump the font-size of its wrapper).
const activityIcon = { fontSize: "1rem", display: "inline-flex", flex: "none" };
// File cell: stack multiple download links (imports show uploaded + results).
const fileList = { display: "flex", flexDirection: "column", gap: ".15rem", alignItems: "flex-start" };
