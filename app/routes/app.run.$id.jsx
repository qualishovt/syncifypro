/**
 * app/routes/app.run.$id.jsx
 *
 * One run's own page (/app/jobs/:id) — export or import. Live progress while
 * it runs (the page polls its loader), then the result: download, row counts,
 * and on-demand delivery to a saved server or an ad-hoc FTP/SFTP URL.
 *
 * The Export button navigates here the moment a job starts, so the URL
 * survives refreshes, closed tabs and "check it after lunch"; Activity and
 * Recent-activity rows link here too.
 */

import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, useLocation, useRevalidator, PrefetchPageLinks } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import { buildRemoteUrl } from "../import/urlSource.js";
import { FIELDS_BY_ENTITY, FIELD_LABELS } from "../export/fieldLists.js";
import SharedTextField from "../components/PolarisTextField.jsx";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";
import FormatIcon from "../components/FormatIcon.jsx";
import { ExportIcon, ImportIcon } from "../components/JobKindIcons.jsx";

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const id = String(params.id);

  const db = (await import("../db.server.js")).default;
  const { signDownloadUrl } = await import("../export/delivery/r2.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
  const { parseJobSpec } = await import("../db/bulkExportJob.server.js");

  let kind = "export";
  let j = await db.bulkExportJob.findUnique({ where: { id } });
  if (!j) {
    kind = "import";
    j = await db.bulkImportJob.findUnique({ where: { id } });
  }
  if (j && j.shop !== session.shop) throw data("Run not found", { status: 404 });

  // No row yet: the export page navigates here OPTIMISTICALLY with a
  // client-generated id and the start payload in history state — the page
  // opens instantly and creates the job from here. Render the starting shell.
  if (!j) {
    const { getAppSettings } = await import("../db/appSettings.server.js");
    const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
    const { timezone } = await getAppSettings(session.shop);
    const servers = (await listImportServers(session.shop)).map(serializeImportServer);
    return { job: null, files: [], servers, timezone };
  }

  // Fresh signed URLs for whatever files the run produced (stored ones
  // expire in ~1h; the R2 objects live ~7 days).
  const basename = (k) => String(k).split("/").pop();
  const files = [];
  const sign = async (key, name, main = false) => {
    try {
      const { signedUrl } = await signDownloadUrl(key, name);
      files.push({ url: signedUrl, name, main });
    } catch { /* aged out of R2 */ }
  };
  if (kind === "export" && j.status === "complete" && j.r2Key) {
    await sign(j.r2Key, basename(j.r2Key), true);
  }
  if (kind === "import") {
    if (j.sourceR2Key) await sign(j.sourceR2Key, j.filename || basename(j.sourceR2Key));
    if (j.status === "complete" && j.resultR2Key) await sign(j.resultR2Key, "Import result.xlsx", true);
  }

  const { timezone } = await getAppSettings(session.shop);
  const servers = (await listImportServers(session.shop)).map(serializeImportServer);
  const iso = (d) => (d ? new Date(d).toISOString() : null);

  return {
    job: {
      kind,
      id: j.id,
      number: j.number ?? null,
      status: j.status,
      entity: j.entity ?? "",
      format: j.format ?? "",
      filename: kind === "export"
        ? (j.r2Key ? basename(j.r2Key) : null)
        : (j.filename ?? null),
      rowCount: j.rowCount ?? null,
      created: j.created ?? null,
      updated: j.updated ?? null,
      deleted: j.deleted ?? null,
      failedRows: j.failed ?? null,
      progressCurrent: j.progressCurrent ?? null,
      progressTotal: j.progressTotal ?? null,
      createdAt: iso(j.createdAt),
      completedAt: iso(j.completedAt),
      error: j.errorMessage ?? null,
      // The run's configuration (sheets + column selections + the advanced
      // options), shown read-only on this page like Matrixify/Altera do.
      ...(() => {
        if (kind !== "export" || !j.spec) return { sheets: null, options: null };
        const { specs, options, splitRows } = parseJobSpec(j.spec);
        return {
          sheets: specs?.map((s) => ({
            entity: s.entity,
            fields: s.fields ?? null, // null = all columns
            filters: s.filters ?? {},
            advancedFilters: s.advancedFilters ?? [],
            sort: s.sort ?? null,
          })) ?? null,
          options: { ...(options ?? {}), splitRows: splitRows ?? null },
        };
      })(),
    },
    files,
    servers,
    timezone,
  };
}

// ─── Action (cancel / repeat / deliver) ────────────────────────────────────────

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const id = String(params.id);
  const kind = String(fd.get("kind") || "export");

  try {
    // Start the run this page was optimistically opened for: create the job
    // under THIS page's id, so the loader's polling picks it up.
    if (intent === "start") {
      if (!/^[\w-]{8,64}$/.test(id)) return data({ error: "Bad job id." }, { status: 400 });
      const payload = JSON.parse(String(fd.get("payload") || "{}"));
      let specs = Array.isArray(payload.specs) ? payload.specs : [];
      // Sheet Permissions (Settings): drop any entity blocked there.
      const { getAppSettings } = await import("../db/appSettings.server.js");
      const { isEntityBlocked } = await import("../export/fieldLists.js");
      const { blockedEntities, timezone } = await getAppSettings(session.shop);
      specs = specs.filter((s) => !isEntityBlocked(s.entity, blockedEntities));
      if (specs.length === 0) return data({ error: "Select at least one entity to export." }, { status: 400 });
      // Fresh-vs-retry: the start effect can re-fire (reload, error retry);
      // the job create is idempotent, but the schedule below must not double.
      const { getJob } = await import("../db/bulkExportJob.server.js");
      const fresh = !(await getJob(id));
      const { startExport } = await import("../export/exportJob.js");
      await startExport({
        admin,
        shop: session.shop,
        specs,
        format: payload.format || "csv",
        splitRows: payload.splitRows ?? null,
        options: payload.options ?? {},
        jobId: id,
      });
      // Inline scheduling: the export ALSO becomes a schedule with this exact
      // configuration. Delivery defaults to saving in the app; destinations
      // are configured on the Schedules page. Best-effort — a schedule
      // failure never blocks the run that's already started.
      if (fresh && payload.schedule?.interval && typeof payload.schedule.interval === "object") {
        try {
          const sched = await import("../db/schedule.server.js");
          const okUnits = ["minutes", "hours", "days", "weeks", "months", "years"];
          const unit = payload.schedule.interval.unit;
          const maxRuns = payload.schedule.maxRuns == null
            ? null
            : Math.max(1, parseInt(String(payload.schedule.maxRuns), 10) || 1);
          await sched.createSchedule({
            shop: session.shop,
            type: "export",
            enabled: true,
            frequency: "daily", hour: 3, minute: 0,
            intervalUnit: okUnits.includes(unit) ? unit : "days",
            intervalCount: Math.max(1, parseInt(String(payload.schedule.interval.count), 10) || 1),
            remainingRuns: maxRuns,
            entity: specs.map((x) => x.entity).join(","),
            format: payload.format || "csv",
            spec: JSON.stringify(specs),
            splitRows: payload.splitRows ?? null,
            options: payload.options ? JSON.stringify(payload.options) : null,
            filename: payload.options?.filename ?? null,
            timezone: timezone || "UTC",
          });
        } catch (err) {
          console.warn("[run] inline schedule creation failed:", err?.message || err);
        }
      }
      return { started: true };
    }

    if (intent === "cancel") {
      if (kind === "export") {
        const { requestJobCancel, markJobCancelled, getJob } = await import("../db/bulkExportJob.server.js");
        const ok = await requestJobCancel(session.shop, id);
        const job = await getJob(id);
        if (job?.bulkOperationId) {
          try {
            await admin.graphql(
              `mutation cancel($id: ID!) { bulkOperationCancel(id: $id) { userErrors { message } } }`,
              { variables: { id: job.bulkOperationId } },
            );
            await markJobCancelled({ id });
          } catch { /* the flag alone still stops tracked jobs */ }
        }
        return { ok };
      }
      const { requestImportCancel } = await import("../db/bulkImportJob.server.js");
      return { ok: await requestImportCancel(session.shop, id) };
    }

    if (intent === "repeat") {
      if (kind === "export") {
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
      return { ok: true, goto: `/app/run/${fresh.id}` };
    }

    // On-demand delivery of the finished file to a saved server or a typed URL.
    if (intent === "deliver") {
      const { getJob } = await import("../db/bulkExportJob.server.js");
      const job = await getJob(id);
      if (!job || job.shop !== session.shop || job.status !== "complete" || !job.r2Key) {
        return data({ deliverError: "That export's file is no longer available." }, { status: 400 });
      }
      const { downloadFromR2 } = await import("../export/delivery/r2.js");
      const body = await downloadFromR2(job.r2Key);
      const filename = String(fd.get("filename") || job.r2Key.split("/").pop());
      const target = String(fd.get("target") || "");

      // Ad-hoc destination typed as a URL — credentials ride in the URL
      // itself (ftp://user:pass@host/folder), nothing is saved.
      if (target === "url") {
        const raw = String(fd.get("url") || "").trim();
        let u;
        try { u = new URL(raw); } catch {
          return data({ deliverError: "That doesn't look like a valid URL." }, { status: 400 });
        }
        const protocol = u.protocol.replace(/:$/, "").toLowerCase();
        if (!["ftp", "ftps", "sftp"].includes(protocol)) {
          return data({ deliverError: "Use an ftp://, ftps:// or sftp:// URL — e.g. ftp://user:pass@host/folder." }, { status: 400 });
        }
        const { uploadToFtp } = await import("../schedules/delivery.server.js");
        const where = await uploadToFtp({
          protocol,
          host: u.hostname,
          port: u.port ? Number(u.port) : undefined,
          user: decodeURIComponent(u.username || ""),
          password: decodeURIComponent(u.password || ""),
          path: decodeURIComponent(u.pathname || ""),
        }, { filename, body });
        return { delivered: where };
      }

      const { getImportServer } = await import("../db/importServer.server.js");
      const server = await getImportServer(session.shop, target);
      if (!server) return data({ deliverError: "Pick a saved server or type a URL." }, { status: 400 });
      const path = String(fd.get("path") || "").trim();
      if (server.protocol === "s3") {
        const { uploadToS3 } = await import("../schedules/delivery.server.js");
        const where = await uploadToS3({
          bucket: server.host,
          region: server.region || "us-east-1",
          accessKeyId: server.username,
          secretAccessKey: server.password,
          prefix: path,
        }, { filename, body, contentType: "application/octet-stream" });
        return { delivered: where };
      }
      if (server.protocol === "https") {
        return data({ deliverError: "HTTP(S) servers are download sources — pick an FTP/SFTP/S3 server or type a URL." }, { status: 400 });
      }
      const { uploadToFtp } = await import("../schedules/delivery.server.js");
      const where = await uploadToFtp({
        protocol: server.protocol,
        host: server.host,
        port: server.port,
        user: server.username,
        password: server.password,
        path,
      }, { filename, body });
      return { delivered: where };
    }

    return data({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return data({ error: err.message, deliverError: intent === "deliver" ? err.message : undefined }, { status: 500 });
  }
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

// Display names for the apostrophe-prefix modes (options.apostrophe).
const APOSTROPHE_LABELS = { phones: "Phone numbers", numbers: "Numbers", all: "All values" };
// Display names for the CSV dialect options (options.csv).
const CSV_DELIMITER_LABELS = { ",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab", "|": "Pipe (|)" };
const CSV_ENCODING_LABELS = { utf8: "UTF-8", utf16le: "UTF-16 LE", latin1: "Windows-1252 / Latin-1" };
const isDefaultCsv = (c) => !c || (
  (!c.delimiter || c.delimiter === ",") && (!c.quote || c.quote === '"')
  && c.newline !== "\n" && !c.forceQuotes && !c.bom
  && (!c.encoding || c.encoding === "utf8")
);
const STATUS_TONE = { complete: "success", failed: "critical", running: "info", pending: "info", cancelled: "warning" };
const STATUS_LABEL = { complete: "Complete", failed: "Failed", running: "Running", pending: "Queued", cancelled: "Cancelled" };
const FORMAT_LABELS = {
  csv: "CSV", excel: "Excel", xml: "XML", json: "JSON", pdf: "PDF",
  csv_shopify: "Shopify CSV", google_feed: "Google Shopping Feed",
};

export default function JobPage() {
  const { job, files, servers, timezone } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const actionFetcher = useFetcher();  // start / cancel / repeat
  const deliverFetcher = useFetcher();

  // Opened optimistically from the Export button: no job row yet, the start
  // payload rides in history state. Fire the start once; the polling below
  // picks the row up as soon as it exists.
  const startPayload = location.state?.start ?? null;
  const startFired = useRef(false);
  useEffect(() => {
    if (job || !startPayload || startFired.current) return;
    startFired.current = true;
    actionFetcher.submit(
      { intent: "start", payload: JSON.stringify(startPayload) },
      { method: "post" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, startPayload]);

  const starting = !job;
  const running = starting || job.status === "running" || job.status === "pending";

  // When completion lands, the bar is usually mid-glide (or hasn't moved at
  // all on small stores — the data arrives with the "complete" status). Hold
  // the progress view for a beat so the bar visibly sweeps to 100% BEFORE
  // the result card replaces it. Entered DURING RENDER (guarded set-state),
  // not in an effect — an effect runs after paint, which let the result card
  // flash for one frame before the hold kicked in.
  const [finishing, setFinishing] = useState(false);
  const wasRunning = useRef(false);
  if (wasRunning.current && !running && job?.status === "complete" && !finishing) {
    wasRunning.current = false; // consume the transition — enter the hold once
    setFinishing(true);
  }
  useEffect(() => {
    if (running) wasRunning.current = true;
  }, [running]);
  useEffect(() => {
    if (!finishing) return undefined;
    const t = setTimeout(() => setFinishing(false), 1100);
    return () => clearTimeout(t);
  }, [finishing]);

  // Live progress: refresh this page's data every second while the run is
  // going (and while we're waiting for the optimistic start to land) — small
  // stores finish in a few seconds, so slower sampling misses the whole bar.
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 1000);
    return () => clearInterval(interval);
  }, [running, revalidator]);

  // A repeat starts a NEW run — follow it to its own page.
  const goto = actionFetcher.data?.goto;
  useEffect(() => {
    if (goto && actionFetcher.state === "idle") navigate(goto);
  }, [goto, actionFetcher.state, navigate]);

  // ── Delivery state (exports only) ─────────────────────────────────────────
  const [deliverTarget, setDeliverTarget] = useState("");
  const [deliverUrl, setDeliverUrl] = useState("");
  const [addingServer, setAddingServer] = useState(false);
  const [deliverTriggerRef, deliverTriggerWidth] = useElementWidth();
  const delivering = deliverFetcher.state !== "idle";
  // The Sheets configuration card starts collapsed.
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);

  // ── Starting shell: the page is open before the job row exists ────────────
  if (starting) {
    const startError = actionFetcher.data?.error;
    return (
      <s-page heading="Export">
        <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>
        <style>{`
          .rp-toggle { display: block; width: 100%; border: 0; padding: 1rem; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; }
          .fmt-badge svg { width: 12px; height: 12px; }
          .jp-track { height: 6px; border-radius: 3px; background: #e3e5e7; overflow: hidden; position: relative; }
          .jp-pulse { position: absolute; inset: 0; width: 40%; border-radius: 3px; background: #1a1a1a; animation: jp-indeterminate 1.4s infinite linear; }
          @keyframes jp-indeterminate { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
        `}</style>
        <s-section>
          <s-stack direction="block" gap="base">
            {startError ? (
              <>
                <s-banner tone="critical">{startError}</s-banner>
                <div><s-button href="/app/export">Back to Export</s-button></div>
              </>
            ) : startPayload ? (
              <>
                {/* Same status-head grid as the live view — including a
                    (disabled) Cancel button — so nothing shifts when the
                    real job data replaces this shell. */}
                <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-badge tone="info">Starting</s-badge>
                    <s-badge>
                      <span className="fmt-badge" style={formatLabelWrap}>
                        <ExportIcon />
                        Export
                      </span>
                    </s-badge>
                    <s-badge>
                      <span className="fmt-badge" style={formatLabelWrap}>
                        <FormatIcon format={startPayload.format} />
                        {FORMAT_LABELS[startPayload.format] ?? String(startPayload.format ?? "").toUpperCase()}
                      </span>
                    </s-badge>
                  </s-stack>
                  <s-stack direction="inline" gap="small-200">
                    <s-button variant="secondary" tone="critical" disabled>Cancel</s-button>
                  </s-stack>
                </s-grid>

                {/* Same tight progress stack as the live view. Empty track on
                    purpose — the bar first MOVES only once a real percentage
                    exists, so it can never appear to reset. */}
                <s-stack direction="block" gap="small-300">
                  <s-text>Starting your export…</s-text>
                  <div className="jp-track" />
                  <s-text color="subdued">
                    You can leave this page — the run continues on the server, and this
                    page shows the result whenever you come back.
                  </s-text>
                </s-stack>

                {/* The same facts grid as the live view, so the page arrives
                    whole — known values filled from the start payload, the
                    rest as placeholders that fill in as data lands. */}
                <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
                  <Fact label="ID"><span style={mutedValue}>—</span></Fact>
                  <Fact label="Format">
                    {FORMAT_LABELS[startPayload.format] ?? String(startPayload.format ?? "").toUpperCase()}
                  </Fact>
                  <Fact label="Started">Just now</Fact>
                  <Fact label="Finished"><span style={mutedValue}>—</span></Fact>
                  <Fact label="Duration"><span style={mutedValue}>—</span></Fact>
                  <Fact label="Records"><span style={mutedValue}>—</span></Fact>
                  {/* The option facts too — the live grid shows them, so the
                      shell must as well or the card grows a row on swap. The
                      start payload already knows every value. */}
                  <Fact label="File name">
                    {startPayload.options?.filename || <span style={mutedValue}>Automatic</span>}
                  </Fact>
                  <Fact label="Split into files">
                    {startPayload.splitRows
                      ? `${Number(startPayload.splitRows).toLocaleString()} records`
                      : <span style={mutedValue}>Off</span>}
                  </Fact>
                  <Fact label="ZIP archive">
                    {startPayload.options?.zip ? "Yes" : <span style={mutedValue}>No</span>}
                  </Fact>
                  <Fact label="Skip when empty">
                    {startPayload.options?.skipEmpty ? "Yes" : <span style={mutedValue}>No</span>}
                  </Fact>
                  <Fact label="Email when done">
                    {startPayload.options?.emailTo || <span style={mutedValue}>—</span>}
                  </Fact>
                </s-grid>
              </>
            ) : (
              <>
                <s-banner tone="warning">
                  This run doesn&rsquo;t exist (or hasn&rsquo;t been created yet).
                </s-banner>
                <div><s-button href="/app/jobs">Open Activity</s-button></div>
              </>
            )}
          </s-stack>
        </s-section>

        {/* The Sheets + Advanced cards too, fed from the start payload — the
            live view shows them, so the shell must as well or the page grows
            when the job row lands. */}
        {!startError && startPayload && (
          <>
            {(startPayload.specs?.length ?? 0) > 0 && (
              <SheetsCard
                sheets={startPayload.specs.map((s) => ({
                  entity: s.entity,
                  fields: s.fields ?? null,
                  filters: s.filters ?? {},
                  advancedFilters: s.advancedFilters ?? [],
                  sort: s.sort ?? null,
                }))}
                open={sheetsOpen}
                onToggle={() => setSheetsOpen((o) => !o)}
              />
            )}
            <AdvancedCard
              options={{ ...(startPayload.options ?? {}), splitRows: startPayload.splitRows ?? null }}
              open={advOpen}
              onToggle={() => setAdvOpen((o) => !o)}
            />
          </>
        )}
      </s-page>
    );
  }

  const mainFile = files.find((f) => f.main) ?? null;
  const busy = actionFetcher.state !== "idle";

  const heading = `${job.kind === "export" ? "Export" : "Import"}${job.number != null ? ` #${job.number}` : ""}`;
  const editHref = job.kind === "export" ? "/app/export" : "/app/import";

  // Three bar states, chosen so the bar NEVER appears to move backwards:
  //   total > 0  → determinate fill (only ever grows)
  //   total null → still counting in the background: EMPTY track, no pulse —
  //                a pulse that later snaps to a low % reads as a reset
  //   total = -1 → genuinely uncountable (e.g. Shopify bulk ops): pulse,
  //                and it stays a pulse to the end
  const total = job.progressTotal;
  const pct = total != null && total > 0
    ? Math.min(100, Math.round(((job.progressCurrent ?? 0) / total) * 100))
    : null;
  const uncountable = total === -1;

  return (
    <s-page heading={heading}>
      <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>
      {/* Title-bar actions follow the run's state: complete → Download (the
          page's #1 job) + Export again; failed/cancelled → run again;
          running → just Back (Cancel stays beside the progress bar). */}
      {job.status === "complete" && !finishing && mainFile && (
        <s-button
          slot="primary-action" icon="download"
          href={mainFile.url}
          target={/\.pdf$/i.test(mainFile.name) ? "_blank" : undefined}
        >
          Download
        </s-button>
      )}
      {(job.status === "failed" || job.status === "cancelled") && (
        <s-button
          slot="primary-action" icon="reset"
          disabled={busy ? true : undefined}
          onClick={() => actionFetcher.submit({ intent: "repeat", kind: job.kind }, { method: "post" })}
        >
          {job.kind === "export" ? "Export again" : "Import again"}
        </s-button>
      )}
      <s-button slot="secondary-actions" variant="tertiary" href="/app">
        Home
      </s-button>
      {/* Back to the setup page this run was configured on — carrying the
          run's configuration in history state so the export page reopens
          with the same entities, columns, filters, sorting and options. */}
      <s-button
        slot="secondary-actions" variant="tertiary" icon="arrow-left"
        onClick={() => navigate(editHref, job.kind === "export" && job.sheets
          ? { state: { restore: { format: job.format, specs: job.sheets, options: job.options } } }
          : undefined)}
      >
        Back
      </s-button>
      {job.status === "complete" && !finishing && (
        <s-button
          slot="secondary-actions" icon="reset"
          disabled={busy ? true : undefined}
          onClick={() => actionFetcher.submit({ intent: "repeat", kind: job.kind }, { method: "post" })}
        >
          {job.kind === "export" ? "Export again" : "Import again"}
        </s-button>
      )}
      <style>{`
        /* Sheets-card header: plain toggle, no hover tint; carries the card
           padding so every pixel of the collapsed card toggles it. */
        .rp-toggle { display: block; width: 100%; border: 0; padding: 1rem; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; }
        /* Format icon shrunk to badge-glyph size inside the format chip. */
        .fmt-badge svg { width: 12px; height: 12px; }
        .jp-track { height: 6px; border-radius: 3px; background: #e3e5e7; overflow: hidden; position: relative; }
        /* Fill tweens over ~the 1s polling interval, so the bar glides
           continuously between updates without lagging behind reality. */
        .jp-fill { height: 100%; border-radius: 3px; background: #1a1a1a; transition: width .9s linear; }
        .jp-pulse { position: absolute; inset: 0; width: 40%; border-radius: 3px; background: #1a1a1a; animation: jp-indeterminate 1.4s infinite linear; }
        @keyframes jp-indeterminate { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
      `}</style>

      {/* ── Files + delivery ── */}
      {files.length > 0 && !finishing && (
        <s-section heading={job.kind === "export" ? "Your file" : "Files"}>
          <s-stack direction="block" gap="base">
            {/* The export's file gets the green "ready" treatment; any other
                files (import source, result workbook) are plain rows. */}
            {job.kind === "export" && mainFile ? (
              <div style={downloadBox}>
                <div style={downloadHead}>
                  <span style={downloadCheck}>
                    <s-icon type="check-circle" tone="success" />
                  </span>
                  <span style={downloadTitle}>Your file is ready</span>
                </div>
                <div style={downloadFileRow}>
                  <span style={downloadFile}>{mainFile.name}</span>
                  {job.rowCount ? (
                    <s-text color="subdued">· {job.rowCount.toLocaleString()} rows</s-text>
                  ) : null}
                </div>
                <div>
                  {/* PDFs open in a viewer tab; other formats download in place. */}
                  <s-button
                    variant="primary"
                    icon="download"
                    href={mainFile.url}
                    target={/\.pdf$/i.test(mainFile.name) ? "_blank" : undefined}
                  >
                    Download
                  </s-button>
                </div>
              </div>
            ) : (
              files.map((f) => (
                <s-grid key={f.name} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                  <span style={{ fontWeight: 600 }}>{f.name}</span>
                  <s-button
                    variant={f.main ? "primary" : "secondary"}
                    icon="download"
                    href={f.url}
                    target={/\.pdf$/i.test(f.name) ? "_blank" : undefined}
                  >
                    Download
                  </s-button>
                </s-grid>
              ))
            )}

            {/* On-demand delivery — exports only. */}
            {job.kind === "export" && mainFile && (
              <>
                <PrefetchPageLinks page="/app/servers" />
                <s-divider />
                <div>
                  <span style={deliverLabel}>Deliver to</span>
                  <div style={fieldHelpWrap}>
                    <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
                      <div ref={deliverTriggerRef} style={{ minWidth: 180 }}>
                        <s-clickable
                          command="--toggle"
                          commandFor="deliver-popover"
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
                            const sel = servers.find((s) => s.id === deliverTarget);
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
                      <s-popover id="deliver-popover" {...widthProps(Math.max(deliverTriggerWidth, 240))}>
                        <s-box padding="small-200">
                          <s-stack direction="block" gap="small-300">
                            {/* URL = ad-hoc destination typed in the field beside;
                                credentials ride in the URL, nothing is saved. */}
                            <PickerRow
                              icon={<s-icon type="link" />}
                              label="URL"
                              selected={!deliverTarget}
                              onSelect={() => setDeliverTarget("")}
                              popoverId="deliver-popover"
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
                                  {/* External glyph: this row navigates to the Servers page. */}
                                  <s-icon type="external" />
                                </span>
                              </s-grid>
                            </s-clickable>
                            <s-text color="subdued">Saved servers</s-text>
                            {servers.filter((s) => s.protocol !== "https").length === 0 && (
                              <s-text color="subdued">No saved servers yet.</s-text>
                            )}
                            {servers.filter((s) => s.protocol !== "https").map((s) => (
                              <PickerRow
                                key={s.id}
                                label={`${s.label} (${String(s.protocol).toUpperCase()})`}
                                selected={deliverTarget === s.id}
                                // Fill the field with the server's URL (username
                                // included; the stored password is injected
                                // server-side at send — it never reaches the
                                // browser). Append a folder to taste.
                                onSelect={() => { setDeliverTarget(s.id); setDeliverUrl(buildRemoteUrl(s, "")); }}
                                popoverId="deliver-popover"
                              />
                            ))}
                          </s-stack>
                        </s-box>
                      </s-popover>
                      <SharedTextField
                        label="Destination URL"
                        labelAccessibilityVisibility="exclusive"
                        placeholder="ftp://user:pass@host/folder — also ftps://, sftp://"
                        value={deliverUrl}
                        onChange={setDeliverUrl}
                      />
                      <s-button
                        disabled={
                          delivering
                          || (!deliverTarget && !/^(ftp|ftps|sftp):\/\/[^\s/]+/i.test(deliverUrl.trim()))
                            ? true : undefined
                        }
                        loading={delivering ? true : undefined}
                        onClick={() =>
                          deliverFetcher.submit({
                            intent: "deliver",
                            filename: mainFile.name,
                            target: deliverTarget || "url",
                            url: deliverUrl.trim(),
                            // Saved-server sends keep their stored credentials;
                            // only the folder is taken from the typed URL.
                            path: (() => { try { return new URL(deliverUrl).pathname; } catch { return ""; } })(),
                          }, { method: "post" })
                        }
                      >
                        Send
                      </s-button>
                    </s-grid>
                    <s-text color="subdued">
                      Push the finished file to a saved FTP/SFTP/S3 server.
                    </s-text>
                  </div>
                </div>
                {deliverFetcher.data?.delivered && (
                  <s-banner tone="success" dismissible>{deliverFetcher.data.delivered}</s-banner>
                )}
                {deliverFetcher.data?.deliverError && (
                  <s-banner tone="critical" dismissible>{deliverFetcher.data.deliverError}</s-banner>
                )}
              </>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section>
        <s-stack direction="block" gap="base">

          {/* ── Status head ── */}
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={STATUS_TONE[job.status] ?? "info"}>
                {job.status === "complete" && (
                  <span style={{ fontSize: ".85em", display: "inline-block", transform: "translateY(-1px)", marginRight: 3 }}>●</span>
                )}
                {STATUS_LABEL[job.status] ?? job.status}
              </s-badge>
              <s-badge>
                <span className="fmt-badge" style={formatLabelWrap}>
                  {job.kind === "export" ? <ExportIcon /> : <ImportIcon />}
                  {job.kind === "export" ? "Export" : "Import"}
                </span>
              </s-badge>
              <s-badge>
                <span className="fmt-badge" style={formatLabelWrap}>
                  <FormatIcon format={job.format} />
                  {FORMAT_LABELS[job.format] ?? String(job.format).toUpperCase()}
                </span>
              </s-badge>
            </s-stack>
            <s-stack direction="inline" gap="small-200">
              {/* Export/Import again moved to the title bar; only the run's
                  own Cancel stays next to the progress it belongs to. */}
              {running && (
                <s-button
                  variant="secondary" tone="critical"
                  disabled={busy ? true : undefined}
                  onClick={() => actionFetcher.submit({ intent: "cancel", kind: job.kind }, { method: "post" })}
                >
                  Cancel
                </s-button>
              )}
            </s-stack>
          </s-grid>

          {/* ── Live progress (held through `finishing` so the bar lands) ── */}
          {(running || finishing) && (() => {
            const pctShown = finishing ? 100 : pct;
            return (
            <s-stack direction="block" gap="small-300">
              <s-text>
                {job.kind === "export" ? "Exporting" : "Importing"}
                {pctShown != null ? ` ${pctShown}%` : "…"}
                {pctShown != null && total > 0
                  ? ` — ${(finishing ? total : job.progressCurrent ?? 0).toLocaleString()} of ${total.toLocaleString()} records`
                  : finishing && job.rowCount
                    ? ` — ${job.rowCount.toLocaleString()} records`
                    : (job.progressCurrent ?? 0) > 0
                      ? ` — ${(job.progressCurrent ?? 0).toLocaleString()} records processed`
                      : ""}
              </s-text>
              <div className="jp-track">
                {uncountable && !finishing
                  ? <div className="jp-pulse" />
                  : (
                    /* Mounted from the start at width 0 (reads as the empty
                       "still counting" track), so the first real percentage
                       GLIDES in rather than popping — and every later update
                       tweens too. */
                    <div className="jp-fill" style={{ width: pctShown != null ? `${Math.max(3, pctShown)}%` : "0%" }} />
                  )}
              </div>
              <s-text color="subdued">
                You can leave this page — the run continues on the server, and this
                page shows the result whenever you come back.
              </s-text>
            </s-stack>
            );
          })()}

          {/* ── Outcome banners ── */}
          {job.status === "failed" && (
            <s-banner tone="critical">{job.error || "The run failed."}</s-banner>
          )}
          {job.status === "cancelled" && (
            <s-banner tone="warning">This run was cancelled.</s-banner>
          )}
          {job.kind === "export" && job.status === "complete" && !mainFile && !finishing && (
            <s-banner tone="info">
              Export finished — there was no data to export, so no file was generated.
            </s-banner>
          )}

          {/* ── Run facts ── */}
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
            <Fact label="ID">{job.number != null ? `#${job.number}` : "—"}</Fact>
            <Fact label="Format">{FORMAT_LABELS[job.format] ?? String(job.format).toUpperCase()}</Fact>
            {/* Exports list their sheets in the dedicated Sheets card below. */}
            {job.kind === "import" && <Fact label="File">{job.filename ?? "—"}</Fact>}
            <Fact label="Started">{dateTime(job.createdAt, timezone)}</Fact>
            <Fact label="Finished">{dateTime(job.completedAt, timezone)}</Fact>
            <Fact label="Duration">{duration(job.createdAt, job.completedAt)}</Fact>
            {job.kind === "export" ? (
              <Fact label="Records">{job.rowCount != null ? job.rowCount.toLocaleString() : "—"}</Fact>
            ) : (
              <Fact label="Result">
                {`${job.created ?? 0} new · ${job.updated ?? 0} updated · ${job.deleted ?? 0} deleted`}
                {job.failedRows ? ` · ${job.failedRows} failed` : ""}
              </Fact>
            )}
            {/* The run's advanced options, as they were applied — defaults
                stay muted so the non-default choices stand out. */}
            {job.kind === "export" && job.options && (
              <>
                <Fact label="File name">
                  {job.options.filename || <span style={mutedValue}>Automatic</span>}
                </Fact>
                <Fact label="Split into files">
                  {job.options.splitRows
                    ? `${Number(job.options.splitRows).toLocaleString()} records`
                    : <span style={mutedValue}>Off</span>}
                </Fact>
                <Fact label="ZIP archive">
                  {job.options.zip ? "Yes" : <span style={mutedValue}>No</span>}
                </Fact>
                <Fact label="Skip when empty">
                  {job.options.skipEmpty ? "Yes" : <span style={mutedValue}>No</span>}
                </Fact>
                <Fact label="Email when done">
                  {job.options.emailTo || <span style={mutedValue}>—</span>}
                </Fact>
              </>
            )}
          </s-grid>

        </s-stack>
      </s-section>

      {/* ── Sheets + Advanced: the run's configuration, read-only. ── */}
      {job.sheets?.length > 0 && (
        <SheetsCard sheets={job.sheets} open={sheetsOpen} onToggle={() => setSheetsOpen((o) => !o)} />
      )}
      {job.kind === "export" && job.options && (
        <AdvancedCard options={job.options} open={advOpen} onToggle={() => setAdvOpen((o) => !o)} />
      )}

      {actionFetcher.data?.error && (
        <s-section>
          <s-banner tone="critical">{actionFetcher.data.error}</s-banner>
        </s-section>
      )}
    </s-page>
  );
}

// ─── small components + helpers ───────────────────────────────────────────────

/* eslint-disable react/prop-types */

// The collapsed-by-default Sheets card — shared between the starting shell
// (fed from the optimistic start payload) and the live view (fed from the
// job row), so the page's height never changes when the real data lands.
function SheetsCard({ sheets, open, onToggle }) {
  return (
    <div style={sheetsCard}>
      <button type="button" className="rp-toggle" onClick={onToggle} aria-expanded={open}>
        <div style={sheetsToggleRow}>
          <span style={{ fontWeight: 650, fontSize: ".875rem" }}>Sheets</span>
          <s-text color="subdued">
            {sheets.map((s) => titleCase(s.entity)).join(", ")}
          </s-text>
          <span style={{ marginLeft: "auto" }}>
            <s-icon type={open ? "chevron-up" : "chevron-down"} />
          </span>
        </div>
      </button>

      {open && (
      <div style={sheetsCardBody}>
      <s-stack direction="block" gap="base">
        {sheets.map((s) => {
          const all = FIELDS_BY_ENTITY[s.entity] ?? [];
          const selected = s.fields ?? all;
          const subset = s.fields != null && all.length > 0 && s.fields.length < all.length;
          const filterBits = [
            ...Object.entries(s.filters ?? {}).map(([k, v]) => `${FIELD_LABELS[k] ?? k}: ${v}`),
            ...(s.advancedFilters ?? []).map((f) =>
              `${FIELD_LABELS[f.column] ?? f.column} ${String(f.operator ?? "").replace(/_/g, " ")} ${f.value ?? ""}`.trim()),
          ];
          return (
            <div key={s.entity}>
              <div style={sheetHead}>
                <span style={{ fontWeight: 600 }}>{titleCase(s.entity)}</span>
                <s-badge tone={subset ? "attention" : "success"}>
                  {selected.length}{all.length ? ` of ${all.length}` : ""} columns
                </s-badge>
              </div>
              {/* Inactive column chips — a record of what ran, not controls. */}
              <div style={colChips}>
                {selected.map((f) => (
                  <span key={f} style={colChip}>{FIELD_LABELS[f] ?? f}</span>
                ))}
              </div>
              {/* Always stated, even when empty — absence is information,
                  styled as the same label/value pairs as the run facts. */}
              <div style={sheetMetaRow}>
                <div style={metaPair}>
                  <span style={factLabel}>Filters</span>
                  <span style={factValue}>
                    {filterBits.length > 0
                      ? filterBits.join(" · ")
                      : <span style={mutedValue}>None</span>}
                  </span>
                </div>
                <div style={metaPair}>
                  <span style={factLabel}>Sorting</span>
                  <span style={factValue}>
                    {(() => {
                      const rules = (Array.isArray(s.sort) ? s.sort : s.sort ? [s.sort] : [])
                        .filter((r) => r?.column);
                      return rules.length > 0
                        ? rules
                            .map((r) => `${FIELD_LABELS[r.column] ?? r.column} · ${r.direction === "desc" ? "descending" : "ascending"}`)
                            .join(", ")
                        : <span style={mutedValue}>None</span>;
                    })()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

      </s-stack>
      </div>
      )}
    </div>
  );
}

// The Advanced card — the export page's own fields, inactive. Shared between
// the starting shell and the live view for the same no-jump reason.
function AdvancedCard({ options, open, onToggle }) {
  return (
    <div style={sheetsCard}>
      <button type="button" className="rp-toggle" onClick={onToggle} aria-expanded={open}>
        <div style={sheetsToggleRow}>
          <span style={{ fontWeight: 650, fontSize: ".875rem" }}>Advanced</span>
          <s-text color="subdued">
            {[
              options.filename && `File name: ${options.filename}`,
              options.splitRows && `Split: ${Number(options.splitRows).toLocaleString()}`,
              options.zip && "ZIP",
              options.skipEmpty && "Skip when empty",
              options.excelDates && "Excel dates",
              options.dateFormat && `Date-time: ${options.dateFormat}`,
              options.apostrophe && `Apostrophe: ${APOSTROPHE_LABELS[options.apostrophe] ?? "All values"}`,
              !isDefaultCsv(options.csv) && "Custom CSV dialect",
              options.emailTo && `Email: ${options.emailTo}`,
            ].filter(Boolean).join(" · ") || "Default options"}
          </s-text>
          <span style={{ marginLeft: "auto" }}>
            <s-icon type={open ? "chevron-up" : "chevron-down"} />
          </span>
        </div>
      </button>

      {open && (
      <div style={sheetsCardBody}>
      <s-stack direction="block" gap="base">

        <div style={advRow}>
          <span style={advRowLabel}>Export file</span>
          <div style={advRowBody}>
            <SharedTextField
              label="File name"
              placeholder="Automatic"
              value={options.filename ?? ""}
              disabled
            />
            <SharedTextField
              label="File name time source"
              value={options.filenameTimeSource === "finished" ? "Finished At" : "Started At (default)"}
              disabled
            />
            <SharedTextField
              label="Split into files of N records"
              placeholder="Off — one file"
              value={options.splitRows ? String(options.splitRows) : ""}
              disabled
            />
            <PolarisCheckbox
              label="Compress export file into a ZIP archive"
              checked={Boolean(options.zip)}
              disabled
            />
            <PolarisCheckbox
              label="Do not generate a file if there is no data"
              checked={Boolean(options.skipEmpty)}
              disabled
            />
          </div>
        </div>

        <hr style={advRule} />

        <div style={advRow}>
          <span style={advRowLabel}>Formatting</span>
          <div style={advRowBody}>
            <PolarisCheckbox
              label="Format date columns as Excel date-time without timezone"
              checked={Boolean(options.excelDates)}
              disabled
            />
            <SharedTextField
              label="Date-time format"
              placeholder="ISO 8601 (default)"
              value={options.dateFormat ?? ""}
              disabled
            />
            <SharedTextField
              label="Prefix values with ' (apostrophe)"
              placeholder="— None —"
              value={options.apostrophe
                ? (APOSTROPHE_LABELS[options.apostrophe] ?? "All values")
                : ""}
              disabled
            />
          </div>
        </div>

        {options.csv && (
          <>
            <hr style={advRule} />
            <div style={advRow}>
              <span style={advRowLabel}>CSV</span>
              <div style={advRowBody}>
                <SharedTextField
                  label="Delimiter"
                  value={CSV_DELIMITER_LABELS[options.csv.delimiter]
                    ?? (options.csv.delimiter ? `Custom (${options.csv.delimiter})` : "Comma (,)")}
                  disabled
                />
                <SharedTextField
                  label="Quotes symbol"
                  value={options.csv.quote === "'"
                    ? "Single quote (')"
                    : !options.csv.quote || options.csv.quote === '"'
                      ? 'Double quote (")'
                      : `Custom (${options.csv.quote})`}
                  disabled
                />
                <SharedTextField
                  label="Newline symbol"
                  value={options.csv.newline === "\n"
                    ? "LF (Linux/Unix/MacOS)"
                    : !options.csv.newline || options.csv.newline === "\r\n"
                      ? "CRLF (General, Windows/MS-DOS)"
                      : `Custom (${String(options.csv.newline).replace(/\r/g, "\\r").replace(/\n/g, "\\n")})`}
                  disabled
                />
                <SharedTextField
                  label="File encoding"
                  value={CSV_ENCODING_LABELS[options.csv.encoding] ?? "UTF-8"}
                  disabled
                />
                <PolarisCheckbox
                  label="Force quotes around every value"
                  checked={Boolean(options.csv.forceQuotes)}
                  disabled
                />
                <PolarisCheckbox
                  label="Include BOM character"
                  checked={Boolean(options.csv.bom)}
                  disabled
                />
              </div>
            </div>
          </>
        )}

        <hr style={advRule} />

        <div style={advRow}>
          <span style={advRowLabel}>Email when done</span>
          <div style={advRowBody}>
            <SharedTextField
              label="Email when done"
              labelAccessibilityVisibility="exclusive"
              placeholder="None"
              value={options.emailTo ?? ""}
              disabled
            />
          </div>
        </div>

      </s-stack>
      </div>
      )}
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <s-stack direction="block" gap="small-500">
      <span style={factLabel}>{label}</span>
      <span style={factValue}>{children}</span>
    </s-stack>
  );
}

// Row inside the deliver popover: check slot → optional icon → label.
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
/* eslint-enable react/prop-types */

/** Measure a trigger's rendered width so its popover can match it. */
function useElementWidth() {
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

function widthProps(w) {
  if (!w) return {};
  return { inlineSize: `${w}px`, minInlineSize: `${w}px`, maxInlineSize: `${w}px` };
}

// "products,product_media" → "Products, Product media": commas separate
// entities; underscores are word breaks INSIDE one entity name.
const titleCase = (s) => String(s ?? "").split(",").map((slug) => {
  const name = slug.trim().split("_").filter(Boolean).join(" ");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}).filter(Boolean).join(", ");

function dateTime(isoStr, tz = "UTC") {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: tz || "UTC",
  });
}

function duration(start, end) {
  if (!start) return "—";
  const ms = (end ? new Date(end) : new Date()) - new Date(start);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ─── styles ───────────────────────────────────────────────────────────────────

// The "file is ready" success box: bordered green card with a bold title and
// a primary download button, rather than a plain banner.
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

// The collapsed-by-default Sheets card: a plain card div whose toggle button
// carries the padding, so the whole collapsed card is the click target.
const sheetsCard = {
  background: "#ffffff", border: "1px solid #e3e5e7", borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.05)", overflow: "hidden",
  // A plain div doesn't get the spacing s-sections receive from the page —
  // give it the same air so it doesn't stick to its neighbours.
  margin: "1rem 0",
};
const sheetsToggleRow = {
  display: "flex", alignItems: "center", gap: ".6rem",
};
const sheetsCardBody = { padding: "0 1rem 1rem" };

// Format icon + name as one inline unit in the status row.
const formatLabelWrap = {
  display: "inline-flex", alignItems: "center", gap: ".35rem", verticalAlign: "middle",
};

// Advanced card rows — the export page's own label/body layout, reused so
// the inactive fields here read as the same form the user filled in.
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
const advRule = {
  border: 0, borderTop: "1px solid #f1f2f3", margin: 0, width: "100%",
};

// Per-sheet meta pairs (Filters / Sort) + the Options grid trim.
const sheetMetaRow = {
  display: "flex", flexWrap: "wrap", gap: "2rem", marginTop: ".6rem",
};
const metaPair = {
  display: "flex", flexDirection: "column", gap: 2,
};
const mutedValue = { color: "#8a9199" };

// Read-only sheet blocks: entity heading + inactive (grey) column chips.
const sheetHead = {
  display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".4rem",
};
const colChips = {
  display: "flex", flexWrap: "wrap", gap: ".3rem",
};
const colChip = {
  fontSize: ".6875rem", color: "#8a9199", background: "#f6f6f7",
  border: "1px solid #e3e5e7", borderRadius: 8, padding: "1px .45rem",
};

const factLabel = {
  fontSize: ".6875rem", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: ".04em", color: "#8a9199",
};
const factValue = { fontSize: ".875rem" };
const deliverLabel = {
  display: "block", fontSize: ".8125rem", fontWeight: 600, marginBottom: ".25rem",
};
// Field + helper text as one tight unit (Polaris helpText gap).
const fieldHelpWrap = { display: "flex", flexDirection: "column", gap: 4 };
// Reserved left column in picker rows so the selected option's checkmark
// sits to the left and all labels stay aligned.
const checkSlot = {
  width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
