/**
 * app/routes/app.jobs.jsx
 *
 * Jobs — the full history of every export and import run, paginated and
 * filterable. The home page's "Recent activity" shows only the latest few
 * and links here for everything else.
 *
 * A "job" is one run (started manually or by a schedule); each row carries
 * its status, record counts, files, and per-row actions (download, repeat,
 * or cancel a run that's still going).
 */

import { useSearchParams, useLoaderData, useFetcher, useNavigate } from "react-router";
import { useEffect } from "react";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import PolarisSelect from "../components/PolarisSelect.jsx";

const PAGE_SIZE = 25;

const TYPES = [
  { value: "all", label: "All types" },
  { value: "export", label: "Exports" },
  { value: "import", label: "Imports" },
];
const STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "complete", label: "Complete" },
  { value: "running", label: "Running" },
  { value: "pending", label: "Queued" },
  { value: "ready", label: "Ready to import" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "all";
  const status = url.searchParams.get("status") ?? "all";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const db = (await import("../db.server.js")).default;
  const { signDownloadUrl } = await import("../export/delivery/r2.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");

  const where = { shop: session.shop, ...(status === "all" ? {} : { status }) };
  const wantExports = type === "all" || type === "export";
  const wantImports = type === "all" || type === "import";

  // Two tables, so take a page's worth from each and merge. Over-fetching by
  // (page × size) keeps the merged ordering right without a cross-table cursor.
  const take = page * PAGE_SIZE + 1;
  const [exports, imports, exportTotal, importTotal] = await Promise.all([
    wantExports ? db.bulkExportJob.findMany({ where, orderBy: { createdAt: "desc" }, take }) : [],
    wantImports ? db.bulkImportJob.findMany({ where, orderBy: { createdAt: "desc" }, take }) : [],
    wantExports ? db.bulkExportJob.count({ where }) : 0,
    wantImports ? db.bulkImportJob.count({ where }) : 0,
  ]);

  const merged = [...exports.map(exportRow), ...imports.map(importRow)]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = exportTotal + importTotal;
  const slice = merged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Stored URLs expire in ~1h; re-sign the visible rows' files.
  const jobs = await Promise.all(slice.map(async (row) => {
    const files = [];
    for (const f of row._files) {
      try {
        const { signedUrl } = await signDownloadUrl(f.key, f.name);
        files.push({ url: signedUrl, name: f.name });
      } catch { /* file aged out of R2 */ }
    }
    const { _files, ...rest } = row; // eslint-disable-line no-unused-vars
    return { ...rest, files };
  }));

  const { timezone } = await getAppSettings(session.shop);
  return { jobs, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), type, status, timezone };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
// "products,product_media" → "Products, Product media": commas separate
// entities; underscores are word breaks INSIDE one entity name.
const titleCase = (s) => String(s ?? "").split(",").map((slug) => {
  const name = slug.trim().split("_").filter(Boolean).join(" ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}).filter(Boolean).join(", ");

function exportRow(j) {
  return {
    id: j.id, type: "export", number: j.number ?? null,
    name: j.filename || titleCase(j.entity),
    format: j.format, status: j.status,
    detail: j.rowCount != null ? `${j.rowCount.toLocaleString()} rows` : "—",
    createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
    errorMessage: j.errorMessage ?? null,
    _files: j.status === "complete" && j.r2Key ? [{ key: j.r2Key, name: j.r2Key.split("/").pop() }] : [],
  };
}

function importRow(j) {
  const files = [];
  if (j.sourceR2Key) files.push({ key: j.sourceR2Key, name: j.filename || "source" });
  if (j.status === "complete" && j.resultR2Key) files.push({ key: j.resultR2Key, name: "Import result.xlsx" });
  // A "ready" preview links back to its import page (to finish configuring
  // and run it) rather than to a run page that has nothing to show yet. Every
  // other import links to its own import page too: the counts, results
  // workbook + deliver-to, failed-rows file and the cards recording what ran
  // live there, not on the generic run page.
  const previewHref = j.status === "ready" && j.sourceR2Key
    ? `/app/import?src=${encodeURIComponent(j.sourceR2Key)}&name=${encodeURIComponent(j.filename || "import")}&job=${encodeURIComponent(j.id)}`
    : `/app/import?jobId=${encodeURIComponent(j.id)}`;
  return {
    id: j.id, type: "import", number: j.number ?? null,
    name: (j.filename || titleCase(j.entity) || "import").replace(/\.[^.]+$/, ""),
    format: j.format, status: j.status,
    detail: j.status === "ready"
      ? "Staged — not imported yet"
      : `${j.created ?? 0} new · ${j.updated ?? 0} upd · ${j.deleted ?? 0} del${j.failed ? ` · ${j.failed} failed` : ""}`,
    createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
    errorMessage: j.errorMessage ?? null,
    href: previewHref,
    _files: files,
  };
}

// ─── Action (repeat / cancel) ──────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const id = String(fd.get("jobId"));
  const type = String(fd.get("type"));

  try {
    if (intent === "cancel") {
      if (type === "export") {
        const { requestJobCancel } = await import("../db/bulkExportJob.server.js");
        return { ok: await requestJobCancel(session.shop, id) };
      }
      const { requestImportCancel } = await import("../db/bulkImportJob.server.js");
      return { ok: await requestImportCancel(session.shop, id) };
    }

    if (intent === "repeat") {
      if (type === "export") {
        const { getJob, parseJobSpec } = await import("../db/bulkExportJob.server.js");
        const { startExport } = await import("../export/exportJob.js");
        const job = await getJob(id);
        if (!job || job.shop !== session.shop) return data({ error: "Export not found." }, { status: 404 });
        const parsed = parseJobSpec(job.spec);
        const specs = parsed.specs
          ?? [{ entity: job.entity, filters: {}, fields: job.fields ? job.fields.split(",") : undefined }];
        const res = await startExport({ admin, shop: session.shop, specs, format: job.format, options: parsed.options, splitRows: parsed.splitRows });
        return { ok: true, goto: `/app/run/${res.jobId}` };
      }
      const { getImportJob, createImportJob } = await import("../db/bulkImportJob.server.js");
      const { enqueueImport } = await import("../queue/importQueue.server.js");
      const job = await getImportJob(id);
      if (!job || job.shop !== session.shop) return data({ error: "Import not found." }, { status: 404 });
      if (!job.sourceR2Key) return data({ error: "The original file is no longer available." }, { status: 400 });
      const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
      const plan = parse(job.plan);
      const options = parse(job.options);
      const fresh = await createImportJob({
        shop: session.shop, entity: job.entity, format: job.format, filename: job.filename,
        sourceR2Key: job.sourceR2Key, progressTotal: job.progressTotal ?? null, plan, options,
      });
      await enqueueImport({ jobId: fresh.id, shop: session.shop, plan, options: options ?? {} });
      return { ok: true, goto: `/app/import?jobId=${fresh.id}` };
    }
    return data({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

// "ready" = an import preview whose file is staged and numbered but not yet
// run (the row Import arms) — a benign, actionable state.
const STATUS_TONE = { complete: "success", failed: "critical", running: "info", pending: "info", ready: "attention", cancelled: "warning" };
const STATUS_LABEL = { complete: "Complete", failed: "Failed", running: "Running", pending: "Queued", ready: "Ready to import", cancelled: "Cancelled" };

export default function JobsPage() {
  const { jobs, total, page, pages, type, status, timezone } = useLoaderData();
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const busy = fetcher.state !== "idle";

  // A repeat starts a NEW job — follow it to its live progress page.
  const goto = fetcher.data?.goto;
  useEffect(() => {
    if (goto && fetcher.state === "idle") navigate(goto);
  }, [goto, fetcher.state, navigate]);

  const setParam = (key, value) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(key, value);
      if (key !== "page") next.set("page", "1"); // a new filter restarts paging
      return next;
    });

  const act = (intent, job) =>
    fetcher.submit({ intent, jobId: job.id, type: job.type }, { method: "post" });

  return (
    <s-page heading="Activity">
      <s-section>
        <s-grid gridTemplateColumns="auto auto 1fr" gap="small-200" alignItems="center">
          <PolarisSelect label="Type" labelAccessibilityVisibility="exclusive" value={type} onChange={(v) => setParam("type", v)}>
            {TYPES.map((t) => <s-option key={t.value} value={t.value}>{t.label}</s-option>)}
          </PolarisSelect>
          <PolarisSelect label="Status" labelAccessibilityVisibility="exclusive" value={status} onChange={(v) => setParam("status", v)}>
            {STATUSES.map((s) => <s-option key={s.value} value={s.value}>{s.label}</s-option>)}
          </PolarisSelect>
          <s-text color="subdued">
            {total.toLocaleString()} job{total === 1 ? "" : "s"}
            {pages > 1 ? ` · page ${page} of ${pages}` : ""}
          </s-text>
        </s-grid>
        {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
      </s-section>

      <s-section>
        {jobs.length === 0 ? (
          <s-paragraph>No activity matches these filters.</s-paragraph>
        ) : (
          <s-table
            variant="auto"
            {...(pages > 1
              ? {
                  paginate: true,
                  hasPreviousPage: page > 1,
                  hasNextPage: page < pages,
                  onPreviousPage: () => setParam("page", String(page - 1)),
                  onNextPage: () => setParam("page", String(page + 1)),
                }
              : {})}
          >
            <s-table-header-row>
              <s-table-header>#</s-table-header>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Format</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Result</s-table-header>
              <s-table-header>Started</s-table-header>
              <s-table-header>Duration</s-table-header>
              <s-table-header>Files</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((j) => {
                const running = j.status === "running" || j.status === "pending";
                return (
                  <s-table-row key={`${j.type}-${j.id}`}>
                    <s-table-cell>
                      <s-link href={j.href ?? `/app/run/${j.id}`}>
                        {j.number ?? "—"}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{j.name}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={j.type === "export" ? "success" : "info"}>
                        {j.type === "export" ? "Export" : "Import"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{String(j.format || "").toUpperCase()}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status] ?? j.status}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {j.status === "failed" && j.errorMessage ? j.errorMessage.slice(0, 60) : j.detail}
                    </s-table-cell>
                    <s-table-cell>{shortDateTime(j.createdAt, timezone)}</s-table-cell>
                    <s-table-cell>{duration(j.createdAt, j.completedAt)}</s-table-cell>
                    <s-table-cell>
                      {j.files.length ? (
                        <s-stack direction="block" gap="small-500">
                          {j.files.map((f, i) => (
                            <s-link key={i} href={f.url} target={/\.pdf$/i.test(f.name) ? "_blank" : undefined}>{f.name}</s-link>
                          ))}
                        </s-stack>
                      ) : <s-text color="subdued">—</s-text>}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-300" alignItems="center">
                        {running ? (
                          <>
                            <s-tooltip id={`cancel-${j.id}`}>Cancel</s-tooltip>
                            <s-button
                              variant="secondary" tone="critical" icon="x"
                              interestFor={`cancel-${j.id}`} accessibilityLabel="Cancel run"
                              disabled={busy ? true : undefined}
                              onClick={() => act("cancel", j)}
                            />
                          </>
                        ) : (
                          <>
                            <s-tooltip id={`repeat-${j.id}`}>Repeat</s-tooltip>
                            <s-button
                              variant="secondary" icon="reset"
                              interestFor={`repeat-${j.id}`} accessibilityLabel="Repeat run"
                              disabled={busy ? true : undefined}
                              onClick={() => act("repeat", j)}
                            />
                          </>
                        )}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function shortDateTime(isoStr, tz = "UTC") {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: tz || "UTC",
  });
}

function duration(start, end) {
  if (!start || !end) return "—";
  const ms = new Date(end) - new Date(start);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
