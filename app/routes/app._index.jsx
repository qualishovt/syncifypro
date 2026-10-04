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
import { useLoaderData, useFetcher, useNavigate, useNavigation, PrefetchPageLinks } from "react-router";
import { data, redirect } from "react-router";
import { authenticate } from "../shopify.server.js";
import { parseImportUrl, buildRemoteUrl } from "../import/urlSource.js";
import { ExportIcon, ImportIcon } from "../components/JobKindIcons.jsx";
import { useElementWidth, widthProps, PickerRow } from "../components/PickerPopover.jsx";
import PolarisTextField from "../components/PolarisTextField.jsx";
import MultiFilter from "../components/MultiFilter.jsx";

const ACTIVITY_TYPES = [
  { value: "export", label: "Exports" },
  { value: "import", label: "Imports" },
];
const ACTIVITY_STATUSES = [
  { value: "complete", label: "Complete" },
  { value: "running", label: "Running" },
  { value: "pending", label: "Queued" },
  { value: "ready", label: "Ready to import" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

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

  // Saved remote servers for "Import from URL" (credentials stay server-side).
  const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
  const servers = (await listImportServers(session.shop)).map(serializeImportServer);

  return { recentActivity, timezone, servers };
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

  // Import from a remote URL: download server-side, then stage exactly like an
  // uploaded file so the New Import page can't tell the difference.
  if (formData.get("intent") === "importUrl") {
    const url = String(formData.get("url") || "").trim();
    try {
      const { fetchImportSources } = await import("../import/urlSource.server.js");
      const files = await fetchImportSources({ shop, url });

      // Single file (any file URL, and every https URL) — stage it directly.
      if (files.length === 1) {
        const { buffer, filename, format } = files[0];
        const mimeType = format === "csv" ? "text/csv" : format === "zip" ? "application/zip" : XLSX_MIME;
        return stageAndRedirect({ shop, buffer, filename, mimeType });
      }

      // A folder with several files — bundle them into one ZIP so the normal
      // import flow shows every file as a sheet in a single job. Nested zips
      // can't be re-bundled; they only work as single-file imports.
      const { zipParts } = await import("../export/formats/zip.js");
      const bundlable = files.filter((f) => f.format !== "zip");
      if (!bundlable.length) {
        return data({ error: "That folder only contains ZIP archives — point the URL at one of them directly." }, { status: 400 });
      }
      const buffer = zipParts(bundlable.map((f) => ({ name: f.filename, data: f.buffer })));
      const stamp = new Date().toISOString().slice(0, 10);
      return stageAndRedirect({ shop, buffer, filename: `folder-import-${stamp}.zip`, mimeType: "application/zip" });
    } catch (err) {
      return data({ error: err.message }, { status: 400 });
    }
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return data({ error: "No file uploaded." }, { status: 400 });
  }
  if (!/\.(csv|xlsx|xls|zip)$/i.test(file.name)) {
    return data({ error: "Unsupported file type. Upload a .csv, .xlsx or .zip file." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = /\.csv$/i.test(file.name) ? "text/csv"
    : /\.zip$/i.test(file.name) ? "application/zip"
    : XLSX_MIME;
  return stageAndRedirect({ shop: session.shop, buffer, filename: file.name, mimeType });
}

/**
 * Stage an import file to R2 and open the New Import page on it — shared by
 * the upload dropzone and the Import-from-URL path.
 */
async function stageAndRedirect({ shop, buffer, filename, mimeType }) {
  const { putToR2 } = await import("../export/delivery/r2.js");
  const { fileStamp } = await import("../utils/fileStamp.js");
  const stamp = fileStamp();
  const safeName = String(filename).replace(/[^\w.-]+/g, "_");
  const key = `imports/${shop}/${stamp}-${safeName}`;
  await putToR2({ buffer, key, mimeType });
  // The preview gets its job number up front (like an export run): a
  // "ready" job row that Import later arms. Best-effort — the preview still
  // works without one, it just shows the number after Import instead.
  let jobParam = "";
  try {
    const { createReadyImportJob } = await import("../db/bulkImportJob.server.js");
    const ext = String(filename).toLowerCase().split(".").pop();
    const format = ext === "csv" ? "csv" : ext === "zip" ? "zip" : "xlsx";
    const ready = await createReadyImportJob({ shop, format, filename, sourceR2Key: key });
    jobParam = `&job=${encodeURIComponent(ready.id)}`;
  } catch { /* the number is a nicety, not a requirement */ }
  return redirect(`/app/import?src=${encodeURIComponent(key)}&name=${encodeURIComponent(filename)}${jobParam}`);
}

// Re-run a past export from its stored spec (entities + filters + columns).
/** Parse a JSON column back to a value; null on absence or bad JSON. */
function parseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function repeatExport(admin, shop, jobId) {
  const { getJob, parseJobSpec } = await import("../db/bulkExportJob.server.js");
  const { startExport } = await import("../export/exportJob.js");
  const job = await getJob(jobId);
  if (!job || job.shop !== shop) return data({ error: "Export not found." }, { status: 404 });
  const parsed = parseJobSpec(job.spec);
  const specs = parsed.specs
    ?? [{ entity: job.entity, filters: {}, fields: job.fields ? job.fields.split(",") : undefined }];
  const res = await startExport({ admin, shop, specs, format: job.format, options: parsed.options });
  return redirect(`/app/run/${res.jobId}`);
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
// Imports get their own page: it shows the counts, the results workbook with
// deliver-to, the failed-rows file and the cards recording what actually ran —
// none of which the generic run page has.
const jobHref = (j) => (j.type === "import" ? `/app/import?jobId=${j.id}` : `/app/run/${j.id}`);

// Duplicate opens the job's configuration for editing (nothing runs): exports
// prefill the Export page from the stored spec; imports reopen the preview on
// the staged file (falling back to the job page if the file is gone).
const duplicateHref = (j) => (j.type === "export"
  ? `/app/export?duplicate=${encodeURIComponent(j.id)}`
  : j.srcKey
    ? `/app/import?src=${encodeURIComponent(j.srcKey)}&name=${encodeURIComponent(j.srcName || "import")}`
    : `/app/import?jobId=${encodeURIComponent(j.id)}`);

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
    entity: j.entity ?? "",
    format: j.format, status: j.status,
    progressCurrent: j.progressCurrent ?? 0, progressTotal: j.progressTotal ?? null,
    created: j.created ?? 0, updated: j.updated ?? 0, deleted: j.deleted ?? 0, failed: j.failed ?? 0,
    rowCount: null,
    createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
    errorMessage: j.errorMessage ?? null,
    // Duplicate needs the staged file to reopen the preview for editing.
    srcKey: j.sourceR2Key ?? null,
    srcName: j.filename ?? null,
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
    entity: j.entity ?? "",
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
  const { recentActivity, timezone, servers } = useLoaderData();
  const stageFetcher = useFetcher(); // stages the upload → redirects to /app/import
  const repeatFetcher = useFetcher(); // re-runs a past job → redirects to its page
  const urlFetcher = useFetcher();    // downloads a remote URL → redirects to /app/import
  const navigate = useNavigate();
  const nav = useNavigation();
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // ── Recent activity: search + filters over the rows on this page ──────────
  const [activityQuery, setActivityQuery] = useState("");
  // Both filters take several values at once, like the Activity page; an
  // empty list means "all", so there is no pseudo-option to keep in sync.
  const [activityType, setActivityType] = useState([]);
  const [activityStatus, setActivityStatus] = useState([]);
  const activityFiltered = activityQuery.trim() !== "" || activityType.length > 0 || activityStatus.length > 0;
  const needle = activityQuery.trim().toLowerCase();
  const visibleActivity = recentActivity.filter((j) => {
    if (activityType.length && !activityType.includes(j.type)) return false;
    if (activityStatus.length && !activityStatus.includes(j.status)) return false;
    if (!needle) return true;
    // Match what the row shows: its number (with or without the #), the name,
    // the file format and the entities behind it.
    return [j.number != null ? `#${j.number}` : "", String(j.number ?? ""), j.name, j.format, j.entity]
      .join(" ").toLowerCase().includes(needle);
  });

  // ── Import from URL: type a URL, or pick a saved server to prefill one ────
  const [serverId, setServerId] = useState("");
  const [importUrl, setImportUrl] = useState("");
  // Selecting a saved server writes its URL into the input; the user can
  // append a path/file, or just import the whole root folder as-is.
  // "— none —" (value "") deselects and empties the input to start over.
  function pickServer(id) {
    setServerId(id);
    const s = servers.find((x) => x.id === id);
    setImportUrl(s ? buildRemoteUrl(s, "") : "");
  }
  const urlValid = parseImportUrl(importUrl).ok;
  const urlImporting = urlFetcher.state !== "idle";
  // Server picker popover: spinner while navigating to Servers, popover
  // matched to its trigger's width.
  const [addingServer, setAddingServer] = useState(false);
  const [serverTriggerRef, serverTriggerWidth] = useElementWidth();
  function importFromUrl() {
    if (urlValid && !urlImporting) urlFetcher.submit({ intent: "importUrl", url: importUrl.trim() }, { method: "post" });
  }

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
                accept=".csv,.xlsx,.xls,.zip"
                onChange={(e) => stageFile(e.target.files?.[0] ?? null)}
                onClick={(e) => e.stopPropagation()}
                style={{ display: "none" }}
              />
              <s-button variant="primary" disabled={uploading} onClick={(e) => { e.stopPropagation(); openPicker(); }}>
                {uploading ? "Uploading…" : "Add file"}
              </s-button>
              <s-text type="strong">or drop file here to upload</s-text>
              <s-text color="subdued">
                Excel (.xlsx), CSV, or a ZIP of CSVs. An Excel workbook holds one sheet per
                entity (Products, Customers, Orders…) and a ZIP one CSV per entity — either
                way, all imported in one job.
              </s-text>
            </div>
            {stageFetcher.data?.error && <s-banner tone="critical">{stageFetcher.data.error}</s-banner>}

            {/* ── Import from URL: saved servers prefill the URL input; the "+"
                opens the Servers page (prefetched, so the jump is instant). */}
            <PrefetchPageLinks page="/app/settings" />
            <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
              {/* Popover server picker (same pattern as the run page's
                  Deliver-to): Direct URL, Add a new server, saved servers. */}
              <div ref={serverTriggerRef} style={{ minWidth: 180 }}>
                <s-clickable
                  command="--toggle"
                  commandFor="home-server-popover"
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
                    const sel = servers.find((s) => s.id === serverId);
                    return (
                      <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
                          {!sel && <s-icon type="link" />}
                          {sel ? `${sel.label} (${String(sel.protocol).toUpperCase()})` : "Direct URL"}
                        </span>
                        <s-icon type="select" />
                      </s-grid>
                    );
                  })()}
                </s-clickable>
              </div>
              <s-popover id="home-server-popover" {...widthProps(Math.max(serverTriggerWidth, 240))}>
                <s-box padding="small-200">
                  <s-stack direction="block" gap="small-300">
                    <PickerRow
                      icon={<s-icon type="link" />}
                      label="Direct URL"
                      selected={!serverId}
                      onSelect={() => pickServer("")}
                      popoverId="home-server-popover"
                    />
                    {/* Navigates — adding a server lives on its own page. */}
                    <s-clickable
                      onClick={() => { setAddingServer(true); navigate("/app/settings?section=servers"); }}
                      padding="small-200"
                      borderRadius="base"
                    >
                      <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
                        <span style={{ width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
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
                    {servers.length === 0 && (
                      <s-text color="subdued">No saved servers yet.</s-text>
                    )}
                    {servers.map((s) => (
                      <PickerRow
                        key={s.id}
                        icon={<s-icon type="database" />}
                        label={`${s.label} (${String(s.protocol).toUpperCase()})`}
                        selected={serverId === s.id}
                        onSelect={() => pickServer(s.id)}
                        popoverId="home-server-popover"
                      />
                    ))}
                  </s-stack>
                </s-box>
              </s-popover>
              <PolarisTextField
                label="Import from URL"
                labelAccessibilityVisibility="exclusive"
                placeholder="https://, ftp://, ftps://, sftp://, s3:// or a Google Drive link"
                value={importUrl}
                onChange={setImportUrl}
                onEnter={importFromUrl}
                disabled={urlImporting}
              />
              <s-button
                variant="primary"
                disabled={!urlValid || urlImporting ? true : undefined}
                loading={urlImporting ? true : undefined}
                onClick={importFromUrl}
              >
                Import from URL
              </s-button>
            </s-grid>
            {urlFetcher.data?.error && <s-banner tone="critical">{urlFetcher.data.error}</s-banner>}
          </s-stack>
        </s-section>

        {/* ── Recent activity: combined imports + exports ──────────── */}
        {recentActivity.length > 0 && (
          <s-section heading="Recent activity">
            {/* Search and filters work on the rows already loaded here — the
                latest ten runs. Anything older lives on the Activity page,
                where the same search runs against the whole history, so the
                link below carries the query across instead of quietly
                returning nothing. */}
            <PolarisTextField
              label="Search recent activity"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by job number, name or format"
              value={activityQuery}
              onChange={setActivityQuery}
            />
            <s-grid gridTemplateColumns="auto auto 1fr" gap="small-200" alignItems="center">
              <MultiFilter
                id="home-type-filter" label="Type" allLabel="All types"
                options={ACTIVITY_TYPES} selected={activityType} onChange={setActivityType}
              />
              <MultiFilter
                id="home-status-filter" label="Status" allLabel="All statuses"
                options={ACTIVITY_STATUSES} selected={activityStatus} onChange={setActivityStatus}
              />
              <s-stack direction="inline" gap="small-300" justifyContent="end" alignItems="center">
                {activityFiltered && (
                  <s-text color="subdued">
                    {visibleActivity.length} of {recentActivity.length} recent
                  </s-text>
                )}
                <s-link href={activityQuery.trim() ? `/app/jobs?q=${encodeURIComponent(activityQuery.trim())}` : "/app/jobs"}>
                  {activityQuery.trim() ? "Search all activity" : "View all activity"}
                </s-link>
              </s-stack>
            </s-grid>
            {visibleActivity.length === 0 && (
              <s-paragraph>
                Nothing in the latest {recentActivity.length} runs matches. Search all activity to look further back.
              </s-paragraph>
            )}
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
                {visibleActivity.map((j) => {
                  const st = statusInfo(j);
                  // clickDelegate points the row at its job link, which is what
                  // makes Polaris tint the row on hover (and open the run on a
                  // click anywhere but the row's own buttons and links). Rows
                  // predating job numbers have no link to delegate to.
                  const linkId = `activity-link-${j.id}`;
                  return (
                    <s-table-row key={j.id} clickDelegate={j.number != null ? linkId : undefined}>
                      <s-table-cell>
                        {j.number != null
                          ? <s-link id={linkId} href={jobHref(j)}>{`#${j.number}`}</s-link>
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
                                // target=_blank: file links are same-origin (/files/:token), and App Bridge would otherwise client-route them. PDFs open in the new tab; other formats download and the tab closes.
                                <s-link key={i} href={f.url} target="_blank">{f.name}</s-link>
                              ))}
                            </span>
                          )
                          : <s-text color="subdued">—</s-text>}
                      </s-table-cell>
                      <s-table-cell>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
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
                          {/* Duplicate: open this job's configuration to
                              tweak and run — Repeat runs it as-is. */}
                          <s-tooltip id={`dup-${j.id}`}>Duplicate</s-tooltip>
                          <s-button
                            interestFor={`dup-${j.id}`}
                            variant="secondary"
                            icon="duplicate"
                            accessibilityLabel="Duplicate"
                            disabled={repeatingId ? true : undefined}
                            onClick={() => navigate(duplicateHref(j))}
                          />
                        </div>
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
          /* 1px dash, like the admin's own media uploader on products/new. */
          border: 1px dashed #c9cccf; border-radius: 8px; background: #fafbfb;
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
// Export/Import glyphs shared with the run page — see components/JobKindIcons.

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_TONE = { complete: "success", failed: "critical", running: "info", pending: "info", ready: "attention", cancelled: "warning" };
const STATUS_LABEL = { complete: "Complete", failed: "Failed", running: "Running", pending: "Queued", ready: "Ready to import", cancelled: "Cancelled" };

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
