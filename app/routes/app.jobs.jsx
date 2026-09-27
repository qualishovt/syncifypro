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
import { useEffect, useState } from "react";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisTextField from "../components/PolarisTextField.jsx";
import MultiFilter from "../components/MultiFilter.jsx";

const PAGE_SIZE = 25;

const TYPES = [
  { value: "export", label: "Exports" },
  { value: "import", label: "Imports" },
];
const PERIODS = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "quarter", label: "Last 90 days" },
];
const STATUSES = [
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
  // Type, status and entity each take SEVERAL values as a comma-list
  // ("?status=complete,failed"); an empty list means no filter at all.
  const listParam = (key) =>
    (url.searchParams.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const type = listParam("type");
  const status = listParam("status");
  const entity = listParam("entity");
  const period = url.searchParams.get("period") ?? "any";
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const db = (await import("../db.server.js")).default;
  const { signDownloadUrl } = await import("../export/delivery/r2.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");

  // Search covers what a merchant can actually see in a row: its number
  // ("#1042" and "1042" both work), the file name, and the entity names.
  const qNumber = parseInt(q.replace(/^#/, ""), 10);
  const search = q
    ? {
        OR: [
          { filename: { contains: q, mode: "insensitive" } },
          { entity: { contains: q, mode: "insensitive" } },
          ...(Number.isFinite(qNumber) ? [{ number: qNumber }] : []),
        ],
      }
    : {};

  const where = {
    shop: session.shop,
    ...(status.length ? { status: { in: status } } : {}),
    // A run's `entity` is itself a comma-list on multi-entity jobs, so each
    // chosen entity matches on substring and any of them is enough.
    ...(entity.length ? { OR: entity.map((e) => ({ entity: { contains: e } })) } : {}),
    ...(periodStart(period) ? { createdAt: { gte: periodStart(period) } } : {}),
    // Both `search` and the entity filter want OR; AND keeps them independent
    // instead of one overwriting the other's key.
    ...(search.OR && entity.length ? { AND: [{ OR: search.OR }] } : search),
  };
  const wantExports = !type.length || type.includes("export");
  const wantImports = !type.length || type.includes("import");

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

  // Entity filter options: every entity this shop has ever run, from the
  // comma-lists both tables store. Unfiltered on purpose — the choices must
  // not shrink as the other filters narrow the rows.
  const [exportEntities, importEntities] = await Promise.all([
    db.bulkExportJob.groupBy({ by: ["entity"], where: { shop: session.shop } }),
    db.bulkImportJob.groupBy({ by: ["entity"], where: { shop: session.shop } }),
  ]);
  const entities = [...new Set(
    [...exportEntities, ...importEntities]
      .flatMap((r) => String(r.entity || "").split(","))
      .map((e) => e.trim())
      .filter(Boolean),
  )].sort();

  const { timezone } = await getAppSettings(session.shop);
  return {
    jobs, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    type, status, entity, period, q, entities, timezone,
  };
}

/** Start of the window a `period` filter covers; null = any time. */
function periodStart(period) {
  const days = { today: 1, week: 7, month: 30, quarter: 90 }[period];
  if (!days) return null;
  const from = new Date();
  if (period === "today") from.setHours(0, 0, 0, 0);
  else from.setTime(from.getTime() - days * 86_400_000);
  return from;
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
    presetName: j.presetName ?? null,
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
    presetName: j.presetName ?? null,
    name: (j.filename || titleCase(j.entity) || "import").replace(/\.[^.]+$/, ""),
    format: j.format, status: j.status,
    detail: j.status === "ready"
      ? "Staged — not imported yet"
      : `${j.created ?? 0} new · ${j.updated ?? 0} upd · ${j.deleted ?? 0} del${j.failed ? ` · ${j.failed} failed` : ""}`,
    createdAt: iso(j.createdAt), completedAt: iso(j.completedAt),
    errorMessage: j.errorMessage ?? null,
    href: previewHref,
    // Duplicate needs the staged file to reopen the preview for editing.
    srcKey: j.sourceR2Key ?? null,
    srcName: j.filename ?? null,
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
        const res = await startExport({ admin, shop: session.shop, specs, format: job.format, options: parsed.options });
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

// Duplicate opens the job's configuration for editing (nothing runs): exports
// prefill the Export page from the stored spec; imports reopen the preview on
// the staged file (falling back to the job page if the file is gone).
const duplicateHref = (j) => (j.type === "export"
  ? `/app/export?duplicate=${encodeURIComponent(j.id)}`
  : j.srcKey
    ? `/app/import?src=${encodeURIComponent(j.srcKey)}&name=${encodeURIComponent(j.srcName || "import")}`
    : `/app/import?jobId=${encodeURIComponent(j.id)}`);
const STATUS_LABEL = { complete: "Complete", failed: "Failed", running: "Running", pending: "Queued", ready: "Ready to import", cancelled: "Cancelled" };

export default function JobsPage() {
  const { jobs, total, page, pages, type, status, entity, period, q, entities, timezone } = useLoaderData();
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const busy = fetcher.state !== "idle";

  // A repeat starts a NEW job — follow it to its live progress page.
  const goto = fetcher.data?.goto;
  useEffect(() => {
    if (goto && fetcher.state === "idle") navigate(goto);
  }, [goto, fetcher.state, navigate]);

  // Arrays go in as comma-lists; an empty value (or an empty list) drops the
  // parameter entirely so a cleared filter leaves a clean URL.
  const setParam = (key, value) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const raw = Array.isArray(value) ? value.join(",") : value;
      if (!raw || raw === "any") next.delete(key);
      else next.set(key, raw);
      if (key !== "page") next.set("page", "1"); // a new filter restarts paging
      return next;
    });

  // The search box types locally and queries a beat later, so each keystroke
  // isn't a round trip to the server; the URL stays the source of truth.
  const [query, setQuery] = useState(q);
  useEffect(() => { setQuery(q); }, [q]);
  useEffect(() => {
    if (query === q) return undefined;
    const t = setTimeout(() => setParam("q", query.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filtered = type.length > 0 || status.length > 0 || entity.length > 0 || period !== "any" || q !== "";
  const clearAll = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      ["q", "type", "status", "entity", "period", "page"].forEach((k) => next.delete(k));
      return next;
    });

  const act = (intent, job) =>
    fetcher.submit({ intent, jobId: job.id, type: job.type }, { method: "post" });

  return (
    <s-page heading="Activity">
      <s-section>
        <PolarisTextField
          label="Search activity"
          labelAccessibilityVisibility="exclusive"
          placeholder="Search by job number, file name or entity"
          value={query}
          onChange={setQuery}
        />
        <s-grid gridTemplateColumns="auto auto auto auto 1fr" gap="small-200" alignItems="center">
          <MultiFilter
            id="jobs-type-filter" label="Type" allLabel="All types"
            options={TYPES} selected={type} onChange={(v) => setParam("type", v)}
          />
          <MultiFilter
            id="jobs-status-filter" label="Status" allLabel="All statuses"
            options={STATUSES} selected={status} onChange={(v) => setParam("status", v)}
          />
          <MultiFilter
            id="jobs-entity-filter" label="Entity" allLabel="All entities"
            options={entities.map((e) => ({ value: e, label: titleCase(e) }))}
            selected={entity} onChange={(v) => setParam("entity", v)}
          />
          <PolarisSelect label="Date" labelAccessibilityVisibility="exclusive" value={period} onChange={(v) => setParam("period", v)}>
            {PERIODS.map((p) => <s-option key={p.value} value={p.value}>{p.label}</s-option>)}
          </PolarisSelect>
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-text color="subdued">
              {total.toLocaleString()} {filtered ? "matching " : ""}job{total === 1 ? "" : "s"}
              {pages > 1 ? ` · page ${page} of ${pages}` : ""}
            </s-text>
            {filtered && <s-button variant="tertiary" onClick={clearAll}>Clear all</s-button>}
          </s-stack>
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
              <s-table-header>Preset</s-table-header>
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
                // clickDelegate points the whole row at its job link: Polaris
                // then tints the row on hover (its own bg-surface-hover) and
                // shows a pointer. Clicks that start on an interactive child
                // (the buttons below, any s-link) are ignored by the delegate,
                // so the row actions keep working.
                const linkId = `job-link-${j.type}-${j.id}`;
                return (
                  <s-table-row key={`${j.type}-${j.id}`} clickDelegate={linkId}>
                    <s-table-cell>
                      <s-link id={linkId} href={j.href ?? `/app/run/${j.id}`}>
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
                    {/* What the run was made with. A run from before this was
                        recorded, or one started from a schedule, shows a dash
                        rather than claiming "no preset". */}
                    <s-table-cell>
                      {j.presetName
                        ? j.presetName
                        : <s-text color="subdued">—</s-text>}
                    </s-table-cell>
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
                            <s-link key={i} href={f.url} target="_blank">{f.name}</s-link>
                          ))}
                        </s-stack>
                      ) : <s-text color="subdued">—</s-text>}
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
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
                            {/* Duplicate: open this job's configuration to
                                tweak and run — Repeat runs it as-is. */}
                            <s-tooltip id={`dup-${j.id}`}>Duplicate</s-tooltip>
                            <s-button
                              variant="secondary" icon="duplicate"
                              interestFor={`dup-${j.id}`} accessibilityLabel="Duplicate job"
                              disabled={busy ? true : undefined}
                              onClick={() => navigate(duplicateHref(j))}
                            />
                          </>
                        )}
                      </div>
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
