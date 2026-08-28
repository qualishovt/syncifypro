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

import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { data, redirect } from "react-router";
import { authenticate } from "../shopify.server.js";
import { analyzeWorkbook } from "../import/importJob.js";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";
import PolarisTextField from "../components/PolarisTextField.jsx";
import PolarisSwitch from "../components/PolarisSwitch.jsx";
import PolarisDateField from "../components/PolarisDateField.jsx";
import { PickerRow, widthProps, useElementWidth, checkSlot } from "../components/PickerPopover.jsx";
import { ENTITIES, ENTITY_ICONS, entityDisplayName } from "../export/entityMeta.js";
import { ImportIcon } from "../components/JobKindIcons.jsx";
import FormatIcon from "../components/FormatIcon.jsx";
import { buildRemoteUrl } from "../import/urlSource.js";

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // A run's own URL (/app/import?jobId=…): the after-import state, distinct
  // from the preview's ?job=&src=&name=. `&poll=1` is the lightweight status
  // poll (job only); without it the loader also rebuilds the preview from the
  // job's stored file + plan, so the locked cards show what ran.
  const empty = { src: null, name: null, preview: null, presets: [], defaultImportMode: "normal", timezone: "UTC", servers: [], readyJob: null };
  const jobId = url.searchParams.get("jobId");
  let runJob = null;
  if (jobId) {
    const { getImportJob } = await import("../db/bulkImportJob.server.js");
    const found = await getImportJob(jobId);
    if (!found || found.shop !== session.shop) return { job: null, ...empty };
    if (url.searchParams.get("poll")) return { job: serializeJob(found), ...empty };
    // A "ready" row is a preview, not a run — hand over to the preview URL.
    if (found.status === "ready" && found.sourceR2Key) {
      return redirect(`/app/import?src=${encodeURIComponent(found.sourceR2Key)}&name=${encodeURIComponent(found.filename || "import")}&job=${encodeURIComponent(found.id)}`);
    }
    if (!found.sourceR2Key) return { job: serializeJob(found), ...empty };
    runJob = found;
  }

  // A staged upload → download + analyze so we can show the options.
  const src = runJob ? runJob.sourceR2Key : url.searchParams.get("src");
  const name = runJob ? (runJob.filename || "import") : url.searchParams.get("name");
  if (!src) return redirect("/app");
  const format = formatFromName(name || src) ?? "csv";

  // The staged file's "ready" job row (created at upload) — its number shows
  // in the info card before the run, and Import arms this same row. A
  // preview opened WITHOUT one (e.g. "Import again" on a finished run) gets
  // a fresh ready row and reloads with it, so it's numbered too. Resolved
  // BEFORE the download + analysis so a redirect costs nothing.
  let readyJob = null;
  if (!runJob) {
    const readyId = url.searchParams.get("job");
    const { getImportJob, createReadyImportJob } = await import("../db/bulkImportJob.server.js");
    if (readyId) {
      const row = await getImportJob(readyId);
      if (row && row.shop === session.shop) {
        if (row.status === "ready") {
          readyJob = { id: row.id, number: row.number ?? null };
        } else {
          // This preview's job has already been started (the post-action
          // revalidation lands here). Follow it to its run URL rather than
          // minting a fresh "ready" row, which would bounce the merchant off
          // the live progress they just kicked off.
          return redirect(`/app/import?jobId=${row.id}`);
        }
      }
    }
    if (!readyJob) {
      try {
        const fresh = await createReadyImportJob({ shop: session.shop, format, filename: name || "import", sourceR2Key: src });
        url.searchParams.set("job", fresh.id);
        return redirect(`${url.pathname}?${url.searchParams.toString()}`);
      } catch { /* fall through — the preview works without a number */ }
    }
  }

  const { downloadFromR2, signDownloadUrl } = await import("../export/delivery/r2.js");
  const { listImportPresets } = await import("../db/importPreset.server.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const fileBuffer = await downloadFromR2(src);
  const { defaultImportMode, blockedEntities, timezone } = await getAppSettings(session.shop);
  // A finished run re-analyzes with the plan it actually ran, so the locked
  // cards show the sheets/columns/filters as they were.
  const runPlan = runJob ? parseJsonOr(runJob.plan, null) : null;
  const { sheets, totals } = analyzeWorkbook({ fileBuffer, format, plan: runPlan ?? undefined, filename: name, blockedEntities });
  // Signed URL + size let the header show the staged file as a download link.
  let fileUrl = null;
  try { fileUrl = (await signDownloadUrl(src, name || "import")).signedUrl; } catch { /* link is optional */ }
  const preview = { filename: name || "import", format, sheets: sheets.map(stripValidRows), totals, fileUrl, fileSize: fileBuffer.length };
  const presets = (await listImportPresets(session.shop)).map(serializePreset);
  // Saved servers for the results-file "Deliver to" picker — the client-safe
  // shape (no password/secret), same as the run page.
  const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
  const servers = (await listImportServers(session.shop)).map(serializeImportServer);
  return {
    job: runJob ? serializeJob(runJob) : null,
    // The run's stored plan/options rehydrate the locked cards.
    runPlan,
    runOptions: runJob ? parseJsonOr(runJob.options, null) : null,
    src, name: name || "import", preview, presets, defaultImportMode, timezone: timezone || "UTC", servers, readyJob,
  };
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
    number: job.number ?? null,
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
  /* Plan gating is loaded lazily so the many non-gated intents stay cheap. */
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();

  // Save / delete a named import preset (plan + mode). Handled before the
  // analyze/apply flow since these don't touch the staged file.
  const intent = formData.get("intent");
  if (intent === "cancel") {
    const { requestImportCancel } = await import("../db/bulkImportJob.server.js");
    const ok = await requestImportCancel(session.shop, String(formData.get("jobId")));
    return { cancelRequested: ok };
  }

  // On-demand delivery of the results workbook to a saved server or an ad-hoc
  // FTP/SFTP URL — the export result page's "Deliver to", for imports.
  if (intent === "deliver") {
    try {
      const { getImportJob } = await import("../db/bulkImportJob.server.js");
      const job = await getImportJob(String(formData.get("jobId")));
      if (!job || job.shop !== session.shop || job.status !== "complete" || !job.resultR2Key) {
        return data({ deliverError: "That import's results file is no longer available." }, { status: 400 });
      }
      const { downloadFromR2 } = await import("../export/delivery/r2.js");
      const body = await downloadFromR2(job.resultR2Key);
      const base = (job.filename || "import").replace(/\.[^.]+$/, "");
      const filename = `${base}-results.xlsx`;
      const target = String(formData.get("target") || "");

      // Ad-hoc destination typed as a URL — credentials ride in the URL
      // itself (ftp://user:pass@host/folder), nothing is saved.
      if (target === "url") {
        const raw = String(formData.get("url") || "").trim();
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
      const path = String(formData.get("path") || "").trim();
      if (server.protocol === "s3") {
        const { uploadToS3 } = await import("../schedules/delivery.server.js");
        const where = await uploadToS3({
          bucket: server.host,
          region: server.region || "us-east-1",
          accessKeyId: server.username,
          secretAccessKey: server.password,
          prefix: path,
        }, { filename, body, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
    } catch (err) {
      return data({ deliverError: err.message }, { status: 500 });
    }
  }

  // "Failed rows only": rebuild a file containing just the rows that errored,
  // with their error text, so the merchant can fix and re-import ONLY those.
  if (intent === "failedRows") {
    try {
      const { getImportJob } = await import("../db/bulkImportJob.server.js");
      const job = await getImportJob(String(formData.get("jobId")));
      if (!job || job.shop !== session.shop || !job.resultR2Key) {
        return data({ error: "That import's results file is no longer available." }, { status: 400 });
      }
      const { downloadFromR2, putToR2, signDownloadUrl } = await import("../export/delivery/r2.js");
      const { parseXLSX } = await import("../import/parsers/xlsx.js");
      const { toExcelWorkbook } = await import("../export/formats/excel.js");

      // The results workbook holds one sheet per imported sheet, each row
      // carrying "Import Result" / "Import Comment" columns.
      const sheets = parseXLSX(await downloadFromR2(job.resultR2Key));
      const failedSheets = [];
      let count = 0;
      for (const sheet of sheets) {
        const failed = (sheet.rows ?? []).filter(
          (r) => String(r["Import Result"] ?? "").toLowerCase() === "failed",
        );
        if (failed.length) {
          failedSheets.push({ name: sheet.name, rows: failed, columns: Object.keys(failed[0]) });
          count += failed.length;
        }
      }
      if (!count) return data({ error: "This import had no failed rows." }, { status: 400 });

      const base = (job.filename || "import").replace(/\.[^.]+$/, "");
      const key = `imports/${session.shop}/failed/${job.id}.xlsx`;
      await putToR2({
        buffer: toExcelWorkbook(failedSheets),
        key,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const { signedUrl } = await signDownloadUrl(key, `${base}-failed-rows.xlsx`);
      return { failedRowsUrl: signedUrl, failedRowsCount: count };
    } catch (err) {
      return data({ error: err.message }, { status: 500 });
    }
  }
  // Deferred "Run on": create an import schedule from the staged file and the
  // current plan/options WITHOUT importing now — the runner re-imports the R2
  // snapshot at the scheduled time (repeats per the optional interval).
  if (intent === "createInlineImportSchedule") {
    {
      const { getPlan, upgradeError } = await import("../billing.server.js");
      const plan = await getPlan(admin);
      if (!plan.schedules) return data(upgradeError("Scheduling", session.shop), { status: 402 });
    }
    try {
      const payload = JSON.parse(String(formData.get("payload") || "{}"));
      if (!payload.src || typeof payload.src !== "string") {
        return data({ error: "Missing file reference — start again from the home page." }, { status: 400 });
      }
      const { getAppSettings } = await import("../db/appSettings.server.js");
      const { timezone } = await getAppSettings(session.shop);
      const { createSchedule, zonedDateTimeToUtc } = await import("../db/schedule.server.js");
      const s = payload.schedule ?? {};
      // The picked timezone wins; the shop's display timezone is the fallback.
      const tz = typeof s.tz === "string" && s.tz.trim() ? s.tz.trim() : (timezone || "UTC");
      const startAt = zonedDateTimeToUtc(s.date, s.hour, s.minute, tz);
      if (!startAt) return data({ error: "Enter the schedule date as YYYY-MM-DD." }, { status: 400 });
      const okUnits = ["minutes", "hours", "days", "weeks", "months", "years"];
      const interval = s.interval && okUnits.includes(s.interval.unit)
        ? {
            intervalUnit: s.interval.unit,
            intervalCount: Math.max(1, parseInt(String(s.interval.count), 10) || 1),
          }
        : {};
      await createSchedule({
        shop: session.shop, type: "import", enabled: true,
        frequency: "daily", hour: 3, minute: 0,
        startAt, ...interval,
        remainingRuns: s.maxRuns == null ? null : Math.max(1, parseInt(String(s.maxRuns), 10) || 1),
        entity: String(payload.entities || "import"),
        format: String(payload.format || "csv"),
        sourceR2Key: String(payload.src),
        filename: payload.name || null,
        plan: Array.isArray(payload.plan) ? JSON.stringify(payload.plan) : null,
        options: payload.options ? JSON.stringify(payload.options) : null,
        timezone: tz,
      });
      return { scheduled: true };
    } catch (err) {
      return data({ error: `Could not create the schedule: ${err?.message || err}` }, { status: 500 });
    }
  }
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
        options: {
          ...(parseJsonOr(formData.get("options"), null) ?? {}),
          mode: String(formData.get("importMode") || "normal"),
        },
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

    // Imports over the plan row cap are blocked (blocking beats silently
    // importing half a file — an import must be all-or-nothing per file).
    {
      const { getPlan, upgradeError } = await import("../billing.server.js");
      const plan = await getPlan(admin);
      if (plan.rowLimit && totals.importable > plan.rowLimit) {
        const e = upgradeError(`Importing more than ${plan.rowLimit.toLocaleString("en-US")} rows on the ${plan.planName} plan (this file has ${totals.importable.toLocaleString("en-US")})`, session.shop);
        return data(e, { status: 402 });
      }
    }

    const { createImportJob, armReadyImportJob } = await import("../db/bulkImportJob.server.js");
    const { enqueueImport } = await import("../queue/importQueue.server.js");

    const entities = [...new Set(sheets.filter((s) => s.ok).map((s) => s.entity))].join(",");
    // Behavior/results options ride along with the mode in the job's options.
    const options = {
      ...(parseJsonOr(formData.get("options"), null) ?? {}),
      mode: importMode,
    };
    const jobFields = {
      shop: session.shop,
      entity: entities,
      format,
      filename: name,
      // Records, not rows — the writers report progress per record (58
      // products), so the total must count the same unit.
      progressTotal: totals.importableRecords ?? totals.importable,
      plan,      // persisted so Repeat/scheduling reuse the same per-sheet config
      options,
    };
    // Prefer arming the preview's "ready" row (keeps the number the merchant
    // already saw); fall back to a fresh row when there isn't one.
    const readyId = String(formData.get("readyJobId") || "");
    const job = (readyId && await armReadyImportJob({ id: readyId, ...jobFields }))
      || await createImportJob({ ...jobFields, sourceR2Key: src });
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
  if (ext === "zip") return "zip";
  return null;
}

/** "Aug 16, 14:05:53" in the given timezone — seconds included, since an
 * import can start and finish within the same minute. */
function dateTime(isoStr, tz = "UTC") {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: tz || "UTC",
  });
}

/** "42s" / "3m 5s" between two ISO instants (end defaults to now). */
function duration(start, end) {
  if (!start) return "—";
  const ms = (end ? new Date(end) : new Date()) - new Date(start);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Human-readable byte size — "2.7 kB", "1.3 MB". */
function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripValidRows(sheet) {
  const { validRows, ...rest } = sheet; // eslint-disable-line no-unused-vars
  return rest;
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

// Every export entity (same list, labels and icons as the export page's Data
// table) — mapping a sheet to one without import support shows "isn't
// supported yet" rather than hiding the option.
const ENTITY_OPTIONS = [
  { value: "auto", label: "Auto-detect", icon: "search" },
  ...ENTITIES.map((e) => ({ value: e, label: entityDisplayName(e), icon: ENTITY_ICONS[e] ?? "database" })),
  { value: "ignore", label: "Ignore this sheet", icon: "x" },
];

// Row-filter conditions — the export page's operator set (matching is shared
// via export/advancedFilters.js: comma-separated "any of" lists).
const FILTER_OPS = [
  { value: "equals_any",      label: "equals to any of" },
  { value: "contains_any",    label: "contains any of" },
  { value: "contains_none",   label: "contains none of" },
  { value: "not_equal_any",   label: "not equal to any of" },
  { value: "starts_with_any", label: "starts with any of" },
  { value: "is_empty",        label: "is empty" },
  { value: "is_not_empty",    label: "is not empty" },
];
const VALUELESS_OPS = new Set(["is_empty", "is_not_empty"]);

// Import-mode choices for the Options card's popover picker: short label on
// the trigger, full explanation (and icon) on the rows.
const MODE_OPTIONS = [
  { value: "normal",     short: "Normal",        label: "Normal — follow the Command column",     icon: "clipboard" },
  { value: "updateOnly", short: "Update only",   label: "Update only — skip new records",         icon: "edit" },
  { value: "createOnly", short: "Create only",   label: "Create only — skip existing records",    icon: "plus" },
  { value: "noDelete",   short: "Add and update", label: "Add new and update existing — ignore delete rows", icon: "refresh" },
  { value: "forceCreate", short: "Create even if exists", label: "Create even if exists (may cause duplicates)", icon: "duplicate" },
  { value: "dryRun",     short: "Dry run",       label: "Dry run — validate, write nothing",      icon: "search" },
];

// Behavior checkboxes (Matrixify's import options + Altera's), saved with the
// job's options and with presets. The first two mirror Matrixify's
// on-by-default choices.
const BEHAVIOR_OPTIONS = [
  {
    key: "createRedirects",
    label: "Generate redirects if handles change",
    info: "When an update changes an existing item's handle, a URL redirect from the old address to the new one is created so links keep working.",
  },
  { key: "ignoreId",              label: "Ignore ID column" },
  { key: "fileOrder",             label: "Import rows in file order" },
  { key: "stripApostrophe",       label: "Remove ' prefixes from values" },
  { key: "transliterateHandles",  label: "Transliterate handles to English alphabet" },
  { key: "continueNextDay",       label: "Continue next day if the daily variant limit is reached" },
  { key: "removeBodyImages",      label: "Remove images from Body HTML" },
];
// Inline scheduling (same as the export page's Advanced → Scheduling).
const REPEAT_UNITS = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
  { value: "years", label: "years" },
];
const REPEAT_COUNTS = Array.from({ length: 90 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
const STOP_AFTER = [
  { value: "until", label: "Until cancelled" },
  ...Array.from({ length: 100 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} run${i ? "s" : ""}` })),
];
const HOURS_00_23 = Array.from({ length: 24 }, (_, i) => {
  const v = String(i).padStart(2, "0");
  return { value: v, label: v };
});
const MINUTES_00_59 = Array.from({ length: 60 }, (_, i) => {
  const v = String(i).padStart(2, "0");
  return { value: v, label: v };
});

const DEFAULT_IMPORT_OPTS = {
  createRedirects: true,
  fileOrder: false,
  stripApostrophe: false,
  ignoreId: false,
  // Matrixify has transliteration on by default.
  transliterateHandles: true,
  continueNextDay: false,
  removeBodyImages: false,
  resultsName: "",
  resultsTimeSource: "started",
  resultsType: "auto",
  // Results-file delivery: "none" = keep in app; "url" = ad-hoc URL typed in
  // resultsDeliverUrl; else a saved server id (+ folder in resultsDeliverPath).
  resultsServerId: "none",
  resultsDeliverUrl: "",
};
const RESULTS_TIME_SOURCES = new Set(["started", "scheduled", "saved"]);

// Information-card status badges — same tones/labels as the run page.
const STATUS_TONE = { complete: "success", failed: "critical", running: "info", pending: "info", cancelled: "warning" };
const STATUS_LABEL = { complete: "Complete", failed: "Failed", running: "Running", pending: "Queued", cancelled: "Cancelled" };

/**
 * Route entry. The page keeps a lot of run state in React state, so going
 * from a finished run's URL (?jobId=…) back to a preview URL ("Import again")
 * must start from a clean mount — otherwise the mounted component keeps
 * showing the old run. The key bumps ONLY on that run → preview transition;
 * the preview → run hop during an import (navigate to ?jobId=) keeps the
 * same instance so live progress isn't interrupted.
 */
export default function ImportRoute() {
  const { job } = useLoaderData();
  const isRun = Boolean(job);
  const gen = useRef(0);
  const wasRun = useRef(isRun);
  if (wasRun.current && !isRun) gen.current += 1;
  wasRun.current = isRun;
  return <ImportPage key={gen.current} />;
}

function ImportPage() {
  const { src, name, preview: initialPreview, job: initialJob, presets: initialPresets, defaultImportMode, timezone, servers, readyJob, runPlan, runOptions } = useLoaderData();
  const fetcher = useFetcher();        // re-analyze / apply
  const pollFetcher = useFetcher();    // job status polling
  const presetFetcher = useFetcher();  // save / delete import presets
  const cancelFetcher = useFetcher();  // asks a running import to stop
  const failedFetcher = useFetcher();  // builds the failed-rows-only file
  const schedFetcher = useFetcher();   // deferred "Run on" schedule creation
  const deliverFetcher = useFetcher(); // on-demand delivery of the results workbook
  const navigate = useNavigate();

  // A run opened at its own URL rehydrates the plan/mode/options it ran with,
  // so the locked cards show the configuration as it was.
  const [plan, setPlan] = useState(Array.isArray(runPlan) ? runPlan : null);
  const [importMode, setImportMode] = useState(runOptions?.mode ?? defaultImportMode ?? "normal");
  const [importOpts, setImportOpts] = useState(runOptions ? { ...DEFAULT_IMPORT_OPTS, ...runOptions } : DEFAULT_IMPORT_OPTS);
  const setOpt = (k, v) => setImportOpts((o) => ({ ...o, [k]: v }));
  // Options as the job/schedule/preset stores them. The ad-hoc delivery URL
  // (which can carry credentials) only rides on a one-off run; anything that
  // PERSISTS (presets, schedules) keeps just the saved-server reference and
  // the typed folder. A saved server's URL contributes only its folder.
  function jobOptions({ persist = false } = {}) {
    const o = { ...importOpts };
    const target = o.resultsServerId;
    if (target === "url") {
      if (persist) o.resultsDeliverUrl = "";
    } else {
      o.resultsDeliverPath = (() => {
        try { return target === "none" ? null : new URL(o.resultsDeliverUrl).pathname; } catch { return null; }
      })();
      o.resultsDeliverUrl = "";
    }
    return o;
  }
  // Options card accordion — collapsed by default, like the export page's
  // Advanced card; the preset stays reachable in the collapsed header.
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Inline scheduling — mirrors the export page's Advanced → Scheduling row.
  const [schedOnEnabled, setSchedOnEnabled] = useState(false);
  const [schedOnDate, setSchedOnDate] = useState("");
  const [schedOnHour, setSchedOnHour] = useState("00");
  const [schedOnMinute, setSchedOnMinute] = useState("00");
  const [schedOnTz, setSchedOnTz] = useState(timezone || "UTC");
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatCount, setRepeatCount] = useState("1");
  const [repeatUnit, setRepeatUnit] = useState("days");
  const [repeatTimes, setRepeatTimes] = useState("until");
  const repeats = schedOnEnabled && repeatEnabled;
  // Every IANA zone the browser knows; the shop's display timezone leads.
  const tzOptions = useMemo(() => {
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { /* older browsers */ }
    if (!zones.length) zones = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Baku", "Asia/Tokyo", "Australia/Sydney"];
    if (!zones.includes("UTC")) zones = ["UTC", ...zones];
    return zones.map((z) => ({ value: z, label: z }));
  }, []);
  const [pollingJobId, setPollingJobId] = useState(null);
  const [presetName, setPresetName] = useState("");
  const [presetId, setPresetId] = useState("");
  const [presetTriggerRef, presetTriggerWidth] = useElementWidth();
  const [modeTriggerRef, modeTriggerWidth] = useElementWidth();
  const [deliverTriggerRef, deliverTriggerWidth] = useElementWidth();
  // What the user last TYPED in URL mode — picking a saved server overwrites
  // the field with the server's URL, so switching back restores this.
  const typedDeliverUrl = useRef("");
  const [addingServer, setAddingServer] = useState(false);
  // Result banner's on-demand "Deliver to" (the export result page's):
  // "" = ad-hoc URL mode, else a saved server id.
  const [resDeliverTarget, setResDeliverTarget] = useState("");
  const [resDeliverUrl, setResDeliverUrl] = useState("");
  const typedResDeliverUrl = useRef("");
  const [resDeliverTriggerRef, resDeliverTriggerWidth] = useElementWidth();
  const delivering = deliverFetcher.state !== "idle";

  const presets = initialPresets ?? [];
  const busy = fetcher.state !== "idle";
  // Only a real "start the import" submission locks the sheet cards —
  // background re-analysis (column ticks, filter edits) must not flash the
  // header controls into their disabled state.
  const applying = busy && fetcher.formData?.get("mode") === "apply";
  const presetBusy = presetFetcher.state !== "idle";
  const d = fetcher.data;
  // Latest analysis wins over the initial (loader) analysis.
  const preview = d?.mode === "analyze" ? d.preview : initialPreview;
  // File link/size come from the loader only — re-analyses don't re-sign.
  const fileUrl = initialPreview?.fileUrl ?? null;
  const fileSize = initialPreview?.fileSize ?? null;
  const error = d?.error || presetFetcher.data?.error;

  const job = pollFetcher.data?.job ?? initialJob ?? null;
  const finished = job && (job.status === "complete" || job.status === "failed" || job.status === "cancelled");
  // A job is in flight or has just landed on this page → the Import buttons
  // and submit bar hide (the result banner offers the next actions), while
  // the Sheets/Options cards stay visible throughout.
  const importing = Boolean(pollingJobId);
  // Every field locks from the moment the import starts and STAYS locked
  // after it finishes — the cards become a read-only record of what ran,
  // exactly like the export result page. New import = start over.
  const locked = applying || importing;

  // Initialise the plan once the first preview is available.
  useEffect(() => {
    if (preview && plan == null) {
      setPlan(preview.sheets.map((s) => ({
        entity: s.ok ? s.entity : "auto",
        include: Boolean(s.ok),
      })));
    }
  }, [preview, plan]);

  // When apply returns a jobId, stay on this page and give the run its own
  // URL (/app/import?jobId=…): it polls live progress and then shows the
  // import-specific result — counts, results workbook, deliver-to, failed
  // rows, and the locked cards recording what actually ran. `replace` keeps
  // Back from re-running apply.
  useEffect(() => {
    if (d?.mode === "apply" && d.jobId) {
      setPollingJobId(d.jobId);
      navigate(`/app/import?jobId=${encodeURIComponent(d.jobId)}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  // Opened from a Recent-activity "#" link (/app/import?jobId=…) — show that job.
  useEffect(() => {
    if (initialJob?.id) setPollingJobId(initialJob.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pollingJobId) pollFetcher.load(`/app/import?jobId=${pollingJobId}&poll=1`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingJobId]);

  useEffect(() => {
    if (!pollingJobId) return;
    if (job?.status === "complete" || job?.status === "failed" || job?.status === "cancelled") return;
    const interval = setInterval(() => {
      pollFetcher.load(`/app/import?jobId=${pollingJobId}&poll=1`);
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
    fd.set("options", JSON.stringify(jobOptions()));
    // Arm the preview's ready row so the run keeps the number shown up front.
    if (readyJob?.id) fd.set("readyJobId", readyJob.id);
    fetcher.submit(fd, { method: "post" });
  }

  // A dropdown/checkbox change re-analyzes with the updated plan.
  function updatePlan(i, patch) {
    const next = plan.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setPlan(next);
    submit("analyze", next);
  }

  // Column ticks update the plan instantly but batch the (server) re-analysis
  // behind a short pause — ticking five boxes costs one request, not five.
  const columnTimer = useRef(null);
  useEffect(() => () => clearTimeout(columnTimer.current), []);
  function updatePlanColumns(i, columns) {
    const next = plan.map((p, idx) => (idx === i ? { ...p, columns } : p));
    setPlan(next);
    clearTimeout(columnTimer.current);
    columnTimer.current = setTimeout(() => submit("analyze", next), 600);
  }

  // Apply a saved preset: restore its plan + mode, then re-analyze the file so
  // counts/filters/columns reflect the loaded config.
  function applyPreset(id) {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const nextMode = p.options?.mode || "normal";
    setImportMode(nextMode);
    // Restore the preset's behavior/results choices (defaults fill gaps; a
    // legacy "finished" time source falls back to "started").
    const merged = { ...DEFAULT_IMPORT_OPTS, ...(p.options ?? {}) };
    if (!RESULTS_TIME_SOURCES.has(merged.resultsTimeSource)) merged.resultsTimeSource = "started";
    // A saved-server delivery is stored as id + folder; rebuild the shown URL
    // (username only — never the password) so the field reads as before.
    const srv = (servers ?? []).find((s) => s.id === merged.resultsServerId);
    if (srv) merged.resultsDeliverUrl = buildRemoteUrl(srv, merged.resultsDeliverPath || "");
    else if (merged.resultsServerId !== "url") merged.resultsServerId = "none";
    setImportOpts(merged);
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

  // "New Import" in the preset popover: back to the file's auto-detected plan.
  function resetPreset() {
    const mode = defaultImportMode ?? "normal";
    setPresetId("");
    setImportMode(mode);
    setImportOpts(DEFAULT_IMPORT_OPTS);
    setPlan(null); // the init effect rebuilds it from the fresh analysis
    const fd = new FormData();
    fd.set("mode", "analyze");
    fd.set("src", src ?? "");
    fd.set("name", name ?? "");
    fd.set("importMode", mode);
    fetcher.submit(fd, { method: "post" });
  }

  const presetLabel = presets.find((p) => p.id === presetId)?.name ?? "New Import";
  const modeOption = MODE_OPTIONS.find((m) => m.value === importMode) ?? MODE_OPTIONS[0];

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
    fd.set("options", JSON.stringify(jobOptions({ persist: true })));
    presetFetcher.submit(fd, { method: "post" });
  }

  function deletePreset() {
    if (!presetId) return;
    presetFetcher.submit({ intent: "deletePreset", presetId }, { method: "post" });
    setPresetId("");
  }

  // "Run on" armed: the Import button defers to a schedule instead of running.
  function scheduleImport() {
    const entities = [...new Set((preview?.sheets ?? [])
      .filter((s, i) => {
        const p = plan?.[i];
        return s.ok && (p ? p.include && p.entity !== "ignore" : true);
      })
      .map((s) => s.entity))].join(",");
    schedFetcher.submit({
      intent: "createInlineImportSchedule",
      payload: JSON.stringify({
        src, name,
        format: preview?.format || "csv",
        entities,
        plan: plan ?? [],
        options: { ...jobOptions({ persist: true }), mode: importMode },
        schedule: {
          date: schedOnDate,
          hour: parseInt(schedOnHour, 10) || 0,
          minute: parseInt(schedOnMinute, 10) || 0,
          tz: schedOnTz,
          interval: repeats ? { count: parseInt(repeatCount, 10) || 1, unit: repeatUnit } : null,
          maxRuns: repeats
            ? (repeatTimes === "until" ? null : parseInt(repeatTimes, 10) || 1)
            : 1,
        },
      }),
    }, { method: "post" });
  }

  function handleImport() {
    if (schedOnEnabled) scheduleImport();
    else submit("apply", plan);
  }

  // Deferred "Run on" created → hand over to the Schedules page.
  useEffect(() => {
    if (schedFetcher.data?.scheduled && schedFetcher.state === "idle") navigate("/app/scheduler");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedFetcher.data, schedFetcher.state]);

  // "Import #240" — the number exists from the preview (the staged file's
  // ready row) and stays the same once the run is armed.
  const jobNumber = job?.number ?? readyJob?.number ?? null;
  const heading = `Import${jobNumber != null ? ` #${jobNumber}` : ""}`;

  return (
    <s-page heading={heading}>
      {/* Breadcrumb → "SyncifyPro > Import"; Back returns to the home. */}
      <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>
      <s-button slot="secondary-actions" variant="tertiary" icon="arrow-left" href="/app">Back</s-button>
      {/* The blue import glyph (Recent activity's icon) marks the page kind. */}
      <span slot="secondary-actions" style={{ display: "inline-flex", alignItems: "center", fontSize: "1.25rem" }} aria-hidden="true">
        <ImportIcon />
      </span>
      {/* Finished: the results workbook is the primary action; "Import again"
          reopens the same staged file with a fresh preview. */}
      {finished && job.status === "complete" && job.resultUrl && (
        <s-button slot="primary-action" variant="primary" icon="download" href={job.resultUrl}>
          Download results
        </s-button>
      )}
      {finished && src && (
        <s-button
          slot="secondary-actions"
          variant="secondary"
          icon="upload"
          // Client-side navigation to the preview URL; ImportRoute remounts
          // the page on this run → preview transition so it starts clean
          // (and the loader stages a fresh, numbered ready job). A raw
          // iframe reload would drop the embedded-session params and land
          // on the app's login page.
          onClick={() => {
            navigate(`/app/import?src=${encodeURIComponent(src)}&name=${encodeURIComponent(name ?? "")}`);
          }}
        >
          Import again
        </s-button>
      )}
      {/* Same action as the bottom bar's Import button. */}
      {preview && !importing && (
        <s-button
          slot="primary-action"
          variant="primary"
          icon={schedOnEnabled ? "calendar" : "upload"}
          onClick={handleImport}
          disabled={busy || preview.totals.importable === 0 ? true : undefined}
          loading={schedFetcher.state !== "idle" ? true : undefined}
        >
          {applying ? "Starting…" : schedOnEnabled ? "Schedule" : (importMode === "dryRun" ? "Dry run" : "Import")}
        </s-button>
      )}

      {/* ── Result banner — a PAGE-LEVEL success banner (the export result
          page's "Your file is ready"): outcome + counts + the next actions.
          Placement matters: as a direct child of s-page it gets the
          prominent title-bar look; inside a section it renders flat. ─── */}
      {finished && job.status === "complete" && (
        <s-banner
          tone={job.failed > 0 ? "warning" : "success"}
          heading={job.failed > 0
            ? `Import finished with ${job.failed} error${job.failed === 1 ? "" : "s"}`
            : "Import finished"}
        >
          {/* The result, colored like the sheet badges: green new/updated,
              red deleted/failed — zeros stay plain. */}
          <span>
            <span style={job.created > 0 ? { color: "#008060", fontWeight: 600 } : undefined}>{job.created} new</span>
            {" · "}
            <span style={job.updated > 0 ? { color: "#008060", fontWeight: 600 } : undefined}>{job.updated} updated</span>
            {" · "}
            <span style={job.deleted > 0 ? { color: "#d72c0d", fontWeight: 600 } : undefined}>{job.deleted} deleted</span>
            {" · "}
            <span style={job.failed > 0 ? { color: "#d72c0d", fontWeight: 600 } : undefined}>{job.failed} failed</span>
          </span>
          {/* Results workbook is always .xlsx — download in place (also the
              title bar's primary action, like the export's Download). */}
          {job.resultUrl && (
            <div style={{ marginTop: ".4rem" }}>
              <s-button variant="secondary" icon="download" href={job.resultUrl}>Download results</s-button>
            </div>
          )}

          {/* On-demand delivery of the results workbook — the export result
              page's "Deliver to", right under the Download button. */}
          {job.resultUrl && (
            <div style={{ marginTop: "1.25rem" }}>
              <span style={{ display: "block", fontSize: ".8125rem", fontWeight: 600, marginBottom: ".25rem" }}>Deliver to</span>
              <div style={fieldHelpWrap}>
                <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
                  <div ref={resDeliverTriggerRef} style={{ minWidth: 180 }}>
                    <s-clickable
                      command="--toggle"
                      commandFor="res-deliver-popover"
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
                        const sel = (servers ?? []).find((s) => s.id === resDeliverTarget);
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
                  <s-popover id="res-deliver-popover" {...widthProps(Math.max(resDeliverTriggerWidth, 240))}>
                    <s-box padding="small-200">
                      <s-stack direction="block" gap="small-300">
                        {/* URL = ad-hoc destination typed in the field beside;
                            credentials ride in the URL, nothing is saved. */}
                        <PickerRow
                          icon={<s-icon type="link" />}
                          label="URL"
                          selected={!resDeliverTarget}
                          onSelect={() => {
                            setResDeliverTarget("");
                            setResDeliverUrl(typedResDeliverUrl.current);
                          }}
                          popoverId="res-deliver-popover"
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
                              <s-icon type="external" />
                            </span>
                          </s-grid>
                        </s-clickable>
                        <s-text color="subdued">Saved servers</s-text>
                        {(servers ?? []).filter((s) => s.protocol !== "https").length === 0 && (
                          <s-text color="subdued">No saved servers yet.</s-text>
                        )}
                        {(servers ?? []).filter((s) => s.protocol !== "https").map((s) => (
                          <PickerRow
                            key={s.id}
                            label={`${s.label} (${String(s.protocol).toUpperCase()})`}
                            selected={resDeliverTarget === s.id}
                            // Fill the field with the server's URL (username
                            // included; the stored password is injected
                            // server-side at send — it never reaches the
                            // browser). Append a folder to taste.
                            onSelect={() => {
                              if (!resDeliverTarget) typedResDeliverUrl.current = resDeliverUrl;
                              setResDeliverTarget(s.id);
                              setResDeliverUrl(buildRemoteUrl(s, ""));
                            }}
                            popoverId="res-deliver-popover"
                          />
                        ))}
                      </s-stack>
                    </s-box>
                  </s-popover>
                  <PolarisTextField
                    label="Destination URL"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="ftp://user:pass@host/folder — also ftps://, sftp://"
                    value={resDeliverUrl}
                    onChange={setResDeliverUrl}
                  />
                  <s-button
                    disabled={
                      delivering
                      || (!resDeliverTarget && !/^(ftp|ftps|sftp):\/\/[^\s/]+/i.test(resDeliverUrl.trim()))
                        ? true : undefined
                    }
                    loading={delivering ? true : undefined}
                    onClick={() =>
                      deliverFetcher.submit({
                        intent: "deliver",
                        jobId: job.id,
                        target: resDeliverTarget || "url",
                        url: resDeliverUrl.trim(),
                        // Saved-server sends keep their stored credentials;
                        // only the folder is taken from the typed URL.
                        path: (() => { try { return new URL(resDeliverUrl).pathname; } catch { return ""; } })(),
                      }, { method: "post" })
                    }
                  >
                    Send
                  </s-button>
                </s-grid>
                <s-text color="subdued">
                  Push the results file to a saved FTP/SFTP/S3 server.
                </s-text>
              </div>
            </div>
          )}
          {job.failed > 0 && (
            <s-button
              slot="secondary-actions"
              disabled={failedFetcher.state !== "idle" ? true : undefined}
              loading={failedFetcher.state !== "idle" ? true : undefined}
              onClick={() => failedFetcher.submit({ intent: "failedRows", jobId: job.id }, { method: "post" })}
            >
              Export failed rows
            </s-button>
          )}
        </s-banner>
      )}
      {finished && job.status === "complete" && deliverFetcher.data?.delivered && (
        <s-banner tone="success" dismissible>{deliverFetcher.data.delivered}</s-banner>
      )}
      {finished && job.status === "complete" && deliverFetcher.data?.deliverError && (
        <s-banner tone="critical" dismissible>{deliverFetcher.data.deliverError}</s-banner>
      )}
      {finished && job.status === "complete" && failedFetcher.data?.failedRowsUrl && (
        <s-banner tone="info" dismissible>
          {failedFetcher.data.failedRowsCount} failed row(s) ready —{" "}
          <s-link href={failedFetcher.data.failedRowsUrl}>download the fix-and-retry file</s-link>.
        </s-banner>
      )}
      {finished && job.status === "complete" && failedFetcher.data?.error && (
        <s-banner tone="critical" dismissible>{failedFetcher.data.error}</s-banner>
      )}

      <s-stack direction="block" gap="base">

        {error && <s-banner tone="critical">{error}</s-banner>}

        {/* ── Information card — the export run page's: status row (badge,
            kind, format) + Cancel while running, the live progress bar, the
            outcome banners for failed/cancelled, then the run facts. Shown
            from the moment an import starts; the file line lives here too
            (the export's info card carries the run's identity the same way). */}
        {(preview || pollingJobId) && (() => {
          // Before a job exists the card describes the staged file: status
          // reads Ready/Nothing to import and the run facts sit as
          // placeholders — the same shell-then-fill the export page does.
          const preRun = !pollingJobId;
          const status = preRun ? null : (job?.status ?? "pending");
          const cur = job?.progressCurrent ?? 0;
          const tot = preRun ? (preview?.totals?.importableRecords ?? null) : (job?.progressTotal ?? null);
          const pct = !preRun && tot ? Math.min(100, Math.round((cur / tot) * 100)) : null;
          const runningNow = !preRun && !finished;
          const ready = (preview?.totals?.importable ?? 0) > 0;
          // Pulse only for a RUNNING job with no countable total; while
          // queued the bar sits empty so it never moves backwards when the
          // first real percentage arrives.
          const indeterminate = status === "running" && tot == null;
          const fmt = preview?.format ?? job?.format ?? "";
          return (
            <s-section>
              <s-stack direction="block" gap="base">

                {/* Cancel — the run's own, right-aligned, only while it runs.
                    (Status and Format are facts in the grid below; the kind
                    is the page heading already.) */}
                {runningNow && (
                  <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                    <span />
                    <s-button
                      variant="secondary" tone="critical"
                      disabled={cancelFetcher.state !== "idle" ? true : undefined}
                      onClick={() => cancelFetcher.submit({ intent: "cancel", jobId: pollingJobId }, { method: "post" })}
                    >
                      Cancel
                    </s-button>
                  </s-grid>
                )}

                {/* Live progress */}
                {runningNow && (
                  <s-stack direction="block" gap="small-300">
                    <s-text>
                      {status === "running" ? "Importing" : "Queued"}
                      {pct != null ? ` ${pct}%` : "…"}
                      {pct != null && tot > 0 ? ` — ${cur.toLocaleString()} of ${tot.toLocaleString()} records` : ""}
                    </s-text>
                    <div className="jp-track" role="progressbar"
                      aria-valuemin={0} aria-valuemax={tot ?? undefined}
                      aria-valuenow={pct != null ? cur : undefined}>
                      {indeterminate
                        ? <div className="jp-pulse" />
                        : <div className="jp-fill" style={{ width: pct != null ? `${Math.max(3, pct)}%` : "0%" }} />}
                    </div>
                    <s-text color="subdued">
                      You can leave this page — the run continues on the server, and this
                      page shows the result whenever you come back.
                    </s-text>
                  </s-stack>
                )}

                {/* Outcome banners (in-section = flat variant) */}
                {finished && status === "failed" && (
                  <s-banner tone="critical">{job.errorMessage || "The import failed."}</s-banner>
                )}
                {finished && status === "cancelled" && (
                  <s-banner tone="warning">This import was cancelled. Rows already written before the cancel stay applied.</s-banner>
                )}

                {/* Run facts. Before the run: 3 + 3 (Status · Format · ID /
                    Records · Rows · Import file — the file last so its long
                    nowrap name has no neighbour to overlap). Once the run
                    exists: 4 + 5 (Status · Format · ID · Import file · [empty]
                    / Started · Finished · Duration · Records · Rows), sharing
                    one 5-column rhythm. */}
                {(() => {
                  const statusFact = (
                    <Fact label="Status">
                      {preRun ? (
                        <s-badge tone={ready ? "success" : "warning"}>
                          {ready ? "Ready to import" : "Nothing to import"}
                        </s-badge>
                      ) : (
                        <s-badge tone={STATUS_TONE[status] ?? "info"}>
                          {status === "complete" && (
                            <span style={{ fontSize: ".85em", display: "inline-block", transform: "translateY(-1px)", marginRight: 3 }}>●</span>
                          )}
                          {STATUS_LABEL[status] ?? status}
                        </s-badge>
                      )}
                    </Fact>
                  );
                  const formatFact = (
                    <Fact label="Format">
                      <span className="fmt-badge" style={formatLabelWrap}>
                        <FormatIcon format={fmt === "xlsx" ? "excel" : fmt} />
                        {String(fmt).toUpperCase() === "XLSX" ? "Excel" : String(fmt).toUpperCase()}
                      </span>
                    </Fact>
                  );
                  const idFact = (
                    <Fact label="ID">
                      {jobNumber != null ? `#${jobNumber}` : <span style={mutedValue}>—</span>}
                    </Fact>
                  );
                  // The name ellipsizes when it's longer than its column; the
                  // size never does (flex: none), so "· 7.0 kB" always shows.
                  const fileName = preview?.filename ?? job?.filename ?? "—";
                  const fileFact = (
                    <Fact label="Import file" span={preRun ? undefined : 2} style={{ minWidth: 0 }}>
                      <span style={fileValueRow} title={fileName}>
                        <span style={fileNameCell}>
                          {fileUrl && preview ? <s-link href={fileUrl}>{fileName}</s-link> : fileName}
                        </span>
                        {fileSize != null && <span style={{ ...mutedValue, flex: "none" }}>&nbsp;· {humanSize(fileSize)}</span>}
                      </span>
                    </Fact>
                  );
                  const recordsFact = (
                    <Fact label="Records">
                      {tot != null ? tot.toLocaleString() : <span style={mutedValue}>—</span>}
                    </Fact>
                  );
                  // Rows in the file — explains the records count (a product
                  // spans several rows).
                  const rowsFact = preview?.totals?.parsed != null
                    ? <Fact label="Rows">{preview.totals.parsed.toLocaleString()}</Fact>
                    : <span aria-hidden="true" />;

                  if (preRun) {
                    return (
                      <>
                        {/* Both rows share a 2fr·1fr·1fr rhythm: the wide first
                            column hosts the long file name in row two, and
                            Status above it. */}
                        <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)" gap="base">
                          {statusFact}{formatFact}{idFact}
                        </s-grid>
                        {/* Import file first (leftmost) — its column is a
                            wide "2fr" so the long name has room; Records and
                            Rows take the narrower right columns. */}
                        <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)" gap="base">
                          {fileFact}{recordsFact}{rowsFact}
                        </s-grid>
                      </>
                    );
                  }
                  return (
                    <>
                      {/* The file fact spans columns 4–5 so the long name has
                          two columns of room and lines up with the row below. */}
                      <s-grid gridTemplateColumns="repeat(5, minmax(0, 1fr))" gap="base">
                        {statusFact}{formatFact}{idFact}{fileFact}
                      </s-grid>
                      <s-grid gridTemplateColumns="repeat(5, minmax(0, 1fr))" gap="base">
                        <Fact label="Started">
                          {job?.createdAt ? dateTime(job.createdAt, timezone) : "Just now"}
                        </Fact>
                        <Fact label="Finished">
                          {finished ? dateTime(job.completedAt, timezone) : <span style={mutedValue}>—</span>}
                        </Fact>
                        <Fact label="Duration">
                          {job?.createdAt ? duration(job.createdAt, job.completedAt) : <span style={mutedValue}>—</span>}
                        </Fact>
                        {recordsFact}{rowsFact}
                      </s-grid>
                    </>
                  );
                })()}
              </s-stack>
            </s-section>
          );
        })()}

        {/* ── New Import: Sheets (left, 2fr) beside Options (right, 1fr),
            mirroring the export page. DOM order = visual order. The cards
            stay while a job runs — the progress banner sits above them. */}
        {preview && (
          <div className="import-cols">

          {/* ── Sheets (top card) ────────────────────────────────────── */}
          <s-section>
            <s-stack direction="block" gap="base">
              <div style={sheetsHeader}>
                <span style={sheetsTitle}>Sheets</span>
                <s-text color="subdued">
                  Each sheet expands to its columns and row filters
                </s-text>
              </div>

              {/* The staged file's identity (name, size, format, readiness)
                  lives in the information card above. */}

              {/* One expandable section per sheet — the export page's Sheets
                  pattern: the collapsed header carries the include tick,
                  mapping, row count and status; expanding reveals columns
                  and row filters. */}
              <s-stack direction="block" gap="small">
                {preview.sheets.map((s, i) => {
                  const p = plan?.[i] ?? { entity: "auto", include: true };
                  return (
                    <SheetCard
                      key={i}
                      sheet={s}
                      plan={p}
                      sheetIndex={i}
                      onPlan={(patch) => updatePlan(i, patch)}
                      onFilters={(filters) => updatePlan(i, { filters })}
                      onColumns={(columns) => updatePlanColumns(i, columns)}
                      disabled={locked}
                    />
                  );
                })}
              </s-stack>

            </s-stack>
          </s-section>

          {/* ── Options (below): collapsible accordion, the export Advanced
              card's label/body rows inside. The whole header toggles; the
              preset cluster stays usable even while collapsed. ───────── */}
          <div style={entityCard}>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div style={optionsHeader} onClick={() => setOptionsOpen((o) => !o)}>
              <span style={sheetsTitle}>Options</span>
              {/* Chevron toggles too; stops propagation so the header's own
                  onClick doesn't also fire. */}
              <s-button
                variant="tertiary"
                icon={optionsOpen ? "chevron-up" : "chevron-down"}
                accessibilityLabel={optionsOpen ? "Collapse options" : "Expand options"}
                onClick={(e) => { e.stopPropagation(); setOptionsOpen((o) => !o); }}
              />
            </div>

            {optionsOpen && (
            <div style={entityCardBody}>
            <s-stack direction="block" gap="base">

              {/* Preset first — it saves/restores every row below. */}
              <div style={advRow}>
                <span style={advRowLabel}>Preset</span>
                <div style={advRowBody}>
                  {/* Field + helper as one tight unit (the export page's
                      fieldHelpWrap rhythm, ~4px). */}
                  <div style={fieldHelpWrap}>
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <div ref={presetTriggerRef} style={{ minWidth: 220, flex: 1 }}>
                      <s-clickable
                        command="--toggle"
                        commandFor="import-preset-popover"
                        disabled={locked || busy || presetBusy ? true : undefined}
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
                          <span style={ellipsis}>{presetLabel}</span>
                          <s-icon type="select" />
                        </s-grid>
                      </s-clickable>
                    </div>
                    <s-button
                      variant="secondary"
                      command="--show"
                      commandFor="save-import-preset-modal"
                      disabled={locked || busy || presetBusy ? true : undefined}
                    >
                      Save
                    </s-button>
                    {presetId && (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={deletePreset}
                        disabled={presetBusy ? true : undefined}
                      >
                        Delete preset
                      </s-button>
                    )}
                    {presetFetcher.data?.presetSaved && presetFetcher.data?.presetName && (
                      <s-text color="subdued">Saved “{presetFetcher.data.presetName}”.</s-text>
                    )}
                  </div>
                  <s-text color="subdued">Saves all your setups in the Sheets above and in the settings below.</s-text>
                  </div>
                  <s-popover id="import-preset-popover" {...widthProps(Math.max(presetTriggerWidth, 220))}>
                    <s-box padding="small-200">
                      <s-stack direction="block" gap="small-300">
                        <PickerRow label="New Import" selected={!presetId} onSelect={resetPreset} popoverId="import-preset-popover" />
                        <s-text color="subdued">Saved</s-text>
                        {presets.length === 0 ? (
                          <s-text color="subdued">No saved presets yet.</s-text>
                        ) : (
                          presets.map((p) => (
                            <PickerRow
                              key={p.id}
                              label={`${p.name} (${String(p.format).toUpperCase()})`}
                              selected={presetId === p.id}
                              onSelect={() => applyPreset(p.id)}
                              popoverId="import-preset-popover"
                            />
                          ))
                        )}
                      </s-stack>
                    </s-box>
                  </s-popover>
                  {/* Save-preset modal (same wording as the export page) */}
                  <s-modal id="save-import-preset-modal" heading="Save your changes as a preset">
                    <PolarisTextField
                      label="Preset name"
                      value={presetName}
                      onChange={setPresetName}
                      placeholder="e.g. Weekly price update"
                    />
                    <s-button
                      slot="primary-action"
                      variant="primary"
                      onClick={savePreset}
                      command="--hide"
                      commandFor="save-import-preset-modal"
                    >
                      Save
                    </s-button>
                    <s-button slot="secondary-actions" command="--hide" commandFor="save-import-preset-modal">
                      Cancel
                    </s-button>
                  </s-modal>
                </div>
              </div>

              {/* Scheduling — same inline "Run on / Repeat every" as the
                  export page; fields stay visible and disable while off. */}
              <div style={advRow}>
                <span style={advRowLabel}>Scheduling</span>
                <div style={schedRowBody}>
                  <PolarisSwitch
                    label="Run on"
                    checked={schedOnEnabled}
                    disabled={locked}
                    onChange={(on) => {
                      setSchedOnEnabled(on);
                      if (on && !schedOnDate) setSchedOnDate(new Date().toISOString().slice(0, 10));
                    }}
                  />
                  <div style={schedGrid}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: "none" }}>
                          <PolarisDateField
                            label="Run on date"
                            labelAccessibilityVisibility="exclusive"
                            value={schedOnDate}
                            onChange={setSchedOnDate}
                            allow={`${new Date().toISOString().slice(0, 10)}--`}
                            disabled={locked || !schedOnEnabled}
                          />
                        </div>
                        <span style={{ whiteSpace: "nowrap", flex: "none" }}>
                          <s-text color="subdued">, at</s-text>
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, flex: "none" }}>
                          <div style={{ width: 66 }}>
                            <PolarisSelect label="Hour" labelAccessibilityVisibility="exclusive" value={schedOnHour} onChange={setSchedOnHour} disabled={locked || !schedOnEnabled}>
                              {HOURS_00_23.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                            </PolarisSelect>
                          </div>
                          <s-text color="subdued">:</s-text>
                          <div style={{ width: 66 }}>
                            <PolarisSelect label="Minute" labelAccessibilityVisibility="exclusive" value={schedOnMinute} onChange={setSchedOnMinute} disabled={locked || !schedOnEnabled}>
                              {MINUTES_00_59.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                            </PolarisSelect>
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 180, marginLeft: 8 }}>
                          <PolarisSelect label="Timezone" labelAccessibilityVisibility="exclusive" value={schedOnTz} onChange={setSchedOnTz} disabled={locked || !schedOnEnabled}>
                            {tzOptions.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                          </PolarisSelect>
                        </div>
                      </div>
                    </div>
                    <div style={{ ...fieldHelpWrap, gridColumn: "1 / -1" }}>
                      <PolarisCheckbox
                        label="Repeat every"
                        checked={repeatEnabled}
                        onChange={setRepeatEnabled}
                        disabled={locked || !schedOnEnabled}
                      />
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <div style={{ width: 76, flex: "none" }}>
                          <PolarisSelect label="Repeat count" labelAccessibilityVisibility="exclusive" value={repeatCount} onChange={setRepeatCount} disabled={locked || !repeats}>
                            {REPEAT_COUNTS.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                          </PolarisSelect>
                        </div>
                        <div style={{ width: 120, flex: "none" }}>
                          <PolarisSelect label="Repeat unit" labelAccessibilityVisibility="exclusive" value={repeatUnit} onChange={setRepeatUnit} disabled={locked || !repeats}>
                            {REPEAT_UNITS.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                          </PolarisSelect>
                        </div>
                        <div style={{ width: 170, flex: "none" }}>
                          <PolarisSelect label="Stop after" labelAccessibilityVisibility="exclusive" value={repeatTimes} onChange={setRepeatTimes} disabled={locked || !repeats}>
                            {STOP_AFTER.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                          </PolarisSelect>
                        </div>
                      </div>
                    </div>
                  </div>
                  <s-text color="subdued">
                    The scheduled import re-runs this file with the current
                    sheets and options — manage it on the Schedules page.
                  </s-text>
                  {schedFetcher.data?.error && (
                    <s-banner tone="critical">{schedFetcher.data.error}</s-banner>
                  )}
                  <div style={{ display: "flex" }}>
                    <s-button href="/app/scheduler">Open Schedules for more</s-button>
                  </div>
                </div>
              </div>

              <div style={advRow}>
                {/* Import mode — icon-carrying popover picker (short label on
                    the trigger, full explanation on the rows). */}
                <span style={advRowLabel}>Import mode</span>
                <div style={advRowBody}>
                <div ref={modeTriggerRef} style={{ width: "100%" }}>
                  <s-clickable
                    command="--toggle"
                    commandFor="import-mode-popover"
                    disabled={locked ? true : undefined}
                    inlineSize="100%"
                    borderWidth="base"
                    borderStyle="solid"
                    borderColor="strong"
                    borderRadius="base"
                    paddingInline="small-100"
                    blockSize="32px"
                    background="base"
                  >
                    <s-grid gridTemplateColumns="auto 1fr auto" gap="small" alignItems="center">
                      <s-icon type={modeOption.icon} />
                      <span style={ellipsis}>{modeOption.short}</span>
                      <s-icon type="select" />
                    </s-grid>
                  </s-clickable>
                </div>
                <s-popover id="import-mode-popover" {...widthProps(Math.max(modeTriggerWidth, 320))}>
                  <s-box padding="small-200">
                    <s-stack direction="block" gap="small-300">
                      {MODE_OPTIONS.map((m) => (
                        <PickerRow
                          key={m.value}
                          label={m.label}
                          icon={<s-icon type={m.icon} />}
                          selected={importMode === m.value}
                          onSelect={() => setImportMode(m.value)}
                          popoverId="import-mode-popover"
                        />
                      ))}
                    </s-stack>
                  </s-box>
                </s-popover>
                </div>
              </div>

              <div style={advRow}>
                {/* Behavior — Matrixify's import options + Altera's
                    checkboxes, saved with the job and with presets. */}
                <span style={advRowLabel}>Behavior</span>
                <div style={{ ...advRowBody, maxWidth: 720 }}>
                  <div style={behaviorGrid}>
                    {BEHAVIOR_OPTIONS.map((o) => (
                      <span key={o.key} style={{ display: "inline-flex", alignItems: "center", gap: ".1rem" }}>
                        <PolarisCheckbox
                          label={o.label}
                          checked={Boolean(importOpts[o.key])}
                          onChange={(v) => setOpt(o.key, v)}
                          disabled={locked}
                        />
                        {o.info && (
                          <>
                            <s-tooltip id={`bhv-tip-${o.key}`}>{o.info}</s-tooltip>
                            <s-button
                              interestFor={`bhv-tip-${o.key}`}
                              variant="tertiary"
                              icon="info"
                              accessibilityLabel={`About: ${o.label}`}
                            />
                          </>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={advRow}>
                {/* Results workbook naming (Matrixify's "Results file"). */}
                <span style={advRowLabel}>Results file</span>
                <div style={{ ...advRowBody, maxWidth: 720 }}>
                  {/* Name input + time source side by side, labels above. */}
                  <div style={{ display: "flex", gap: ".5rem", alignItems: "end" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <PolarisTextField
                        label="File name"
                        value={importOpts.resultsName}
                        onChange={(v) => setOpt("resultsName", v)}
                        placeholder="Import_{date}_{time}"
                      />
                    </div>
                    <div style={{ flex: "none" }}>
                      <PolarisSelect
                        label="Time source"
                        value={importOpts.resultsTimeSource}
                        onChange={(v) => setOpt("resultsTimeSource", v)}
                      >
                        <s-option value="started">Started At</s-option>
                        <s-option value="scheduled">Scheduled At</s-option>
                        <s-option value="saved">Saved At</s-option>
                      </PolarisSelect>
                    </div>
                  </div>
                  <PolarisSelect
                    label="File type"
                    value={importOpts.resultsType}
                    onChange={(v) => setOpt("resultsType", v)}
                  >
                    <s-option value="auto">Decide from uploaded</s-option>
                    <s-option value="csv">CSV</s-option>
                    <s-option value="xlsx">Excel</s-option>
                  </PolarisSelect>
                  {/* Deliver to — the same picker as the run page and the
                      export page's Advanced options, plus a "Nowhere" row. */}
                  <div style={fieldHelpWrap}>
                    <span style={advRowLabel}>Deliver to</span>
                    <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
                      <div ref={deliverTriggerRef} style={{ minWidth: 180 }}>
                        <s-clickable
                          command="--toggle"
                          commandFor="results-deliver-popover"
                          disabled={locked ? true : undefined}
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
                            const t = importOpts.resultsServerId;
                            const sel = (servers ?? []).find((s) => s.id === t);
                            return (
                              <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
                                <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
                                  {t === "none" && <s-icon type="disabled" />}
                                  {t === "url" && <s-icon type="link" />}
                                  {t === "none" ? "Nowhere (keep in app)" : sel ? `${sel.label} (${String(sel.protocol).toUpperCase()})` : "URL"}
                                </span>
                                <s-icon type="select" />
                              </s-grid>
                            );
                          })()}
                        </s-clickable>
                      </div>
                      <s-popover id="results-deliver-popover" {...widthProps(Math.max(deliverTriggerWidth, 240))}>
                        <s-box padding="small-200">
                          <s-stack direction="block" gap="small-300">
                            <PickerRow
                              icon={<s-icon type="disabled" />}
                              label="Nowhere (keep in app)"
                              selected={importOpts.resultsServerId === "none"}
                              onSelect={() => setOpt("resultsServerId", "none")}
                              popoverId="results-deliver-popover"
                            />
                            {/* URL = ad-hoc destination typed in the field
                                beside; credentials ride in the URL and are
                                never saved with presets or schedules. */}
                            <PickerRow
                              icon={<s-icon type="link" />}
                              label="URL"
                              selected={importOpts.resultsServerId === "url"}
                              onSelect={() => {
                                setOpt("resultsServerId", "url");
                                setOpt("resultsDeliverUrl", typedDeliverUrl.current);
                              }}
                              popoverId="results-deliver-popover"
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
                                  <s-icon type="external" />
                                </span>
                              </s-grid>
                            </s-clickable>
                            <s-text color="subdued">Saved servers</s-text>
                            {(servers ?? []).filter((s) => s.protocol !== "https").length === 0 && (
                              <s-text color="subdued">No saved servers yet.</s-text>
                            )}
                            {(servers ?? []).filter((s) => s.protocol !== "https").map((s) => (
                              <PickerRow
                                key={s.id}
                                label={`${s.label} (${String(s.protocol).toUpperCase()})`}
                                selected={importOpts.resultsServerId === s.id}
                                // Fill the field with the server's URL (username
                                // included; the stored password is injected
                                // server-side at send — it never reaches the
                                // browser). Append a folder to taste.
                                onSelect={() => {
                                  if (importOpts.resultsServerId === "url") typedDeliverUrl.current = importOpts.resultsDeliverUrl;
                                  setOpt("resultsServerId", s.id);
                                  setOpt("resultsDeliverUrl", buildRemoteUrl(s, ""));
                                }}
                                popoverId="results-deliver-popover"
                              />
                            ))}
                          </s-stack>
                        </s-box>
                      </s-popover>
                      <PolarisTextField
                        label="Destination URL"
                        labelAccessibilityVisibility="exclusive"
                        placeholder="ftp://user:pass@host/folder — also ftps://, sftp://"
                        value={importOpts.resultsDeliverUrl}
                        onChange={(v) => setOpt("resultsDeliverUrl", v)}
                        disabled={locked || importOpts.resultsServerId === "none"}
                      />
                    </s-grid>
                    <s-text color="subdued">
                      Push the results file to a saved FTP/SFTP/S3 server — sent
                      automatically right after the import completes.
                    </s-text>
                  </div>
                </div>
              </div>

            </s-stack>
            </div>
            )}
          </div>

          </div>
        )}

        {/* ── Submit bar (mirrors the export page's bottom section) ──── */}
        {preview && !importing && (
          <s-section>
            <s-grid gridTemplateColumns="1fr auto auto auto" gap="small" alignItems="center">
              <s-text color="subdued">
                {busy
                  ? "Re-analyzing…"
                  : preview.totals.importable === 0
                    ? "Nothing to import — no sheets selected or all rows invalid."
                    : (
                      /* Badge tones as text: green new, blue update, red
                         delete/invalid — zeros stay subdued so only what
                         this run actually does stands out. */
                      <>
                        <span style={{ color: "#008060", fontWeight: 600 }}>
                          {preview.totals.importable.toLocaleString()} row{preview.totals.importable === 1 ? "" : "s"} ready
                        </span>
                        {" · "}
                        <span style={preview.totals.create > 0 ? { color: "#008060", fontWeight: 600 } : undefined}>
                          {preview.totals.create} new
                        </span>
                        {" · "}
                        <span style={preview.totals.update > 0 ? { color: "#2c6ecb", fontWeight: 600 } : undefined}>
                          {preview.totals.update} update
                        </span>
                        {" · "}
                        <span style={preview.totals.delete > 0 ? { color: "#d72c0d", fontWeight: 600 } : undefined}>
                          {preview.totals.delete} delete
                        </span>
                        {preview.totals.invalid > 0 && (
                          <>
                            {" · "}
                            <span style={{ color: "#d72c0d", fontWeight: 600 }}>
                              {preview.totals.invalid} invalid
                            </span>
                          </>
                        )}
                      </>
                    )}
              </s-text>
              <s-button tone="critical" href="/app">Cancel</s-button>
              <s-button
                variant="secondary"
                onClick={() => submit("analyze", plan)}
                disabled={locked ? true : undefined}
                loading={busy && !applying ? true : undefined}
              >
                Analyze
              </s-button>
              <s-button
                variant="primary"
                icon={schedOnEnabled ? "calendar" : "upload"}
                onClick={handleImport}
                disabled={busy || preview.totals.importable === 0 ? true : undefined}
                loading={schedFetcher.state !== "idle" ? true : undefined}
              >
                {applying
                  ? "Starting…"
                  : schedOnEnabled ? "Schedule" : (importMode === "dryRun" ? "Dry run" : "Import")}
              </s-button>
            </s-grid>
          </s-section>
        )}


      </s-stack>

      <style>{`
        /* Options on top, Sheets below — one column, full width each. */
        .import-cols { display: grid; grid-template-columns: 1fr; gap: 1rem; }
        /* Slim scrollbar for the entity-picker popover list. */
        .entity-pop-list { scrollbar-width: thin; scrollbar-color: #d0d4d9 transparent; }
        .entity-pop-list::-webkit-scrollbar { width: 8px; }
        .entity-pop-list::-webkit-scrollbar-thumb { background: #d0d4d9; border-radius: 4px; }
        .entity-pop-list::-webkit-scrollbar-track { background: transparent; }
        /* Format icon shrunk to badge-glyph size inside the status chips. */
        .fmt-badge svg { width: 12px; height: 12px; }
        /* Progress bar — the run page's; a short ease so each update snaps
           forward promptly rather than dragging behind the next poll. */
        .jp-track { height: 6px; border-radius: 3px; background: #e3e5e7; overflow: hidden; position: relative; }
        .jp-fill { height: 100%; border-radius: 3px; background: #1a1a1a; transition: width .35s ease-out; }
        .jp-pulse { position: absolute; inset: 0; width: 40%; border-radius: 3px; background: #1a1a1a; animation: jp-indeterminate 1.4s infinite linear; }
        @keyframes jp-indeterminate { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
      `}</style>
    </s-page>
  );
}

// ─── components ──────────────────────────────────────────────────────────────

/* eslint-disable react/prop-types */
/**
 * One expandable section per sheet, mirroring the export page's entity
 * cards: the collapsed 60px header carries the include tick, name, entity
 * mapping, row count and status; expanding reveals columns + row filters.
 */
function SheetCard({ sheet, plan, sheetIndex, onPlan, onFilters, onColumns, disabled }) {
  const [open, setOpen] = useState(false);
  const name = sheet.name ?? "Sheet";
  const included = plan.include && plan.entity !== "ignore";
  const columns = sheet.columns ?? [];
  const unknownCount = sheet.unknownColumns?.length ?? 0;
  const filterCols = sheet.filterColumns ?? [];
  const popId = `import-as-${sheetIndex}`;
  const entityOption = ENTITY_OPTIONS.find((o) => o.value === plan.entity)
    ?? { label: plan.entity, icon: "search" };

  // The entity list scrolls inside the popover, sized to run from the
  // trigger down to the bottom of the page (Matrixify's behavior) —
  // measured when the popover is opened.
  const triggerWrapRef = useRef(null);
  const [listMaxH, setListMaxH] = useState(340);
  const sizeList = () => {
    const r = triggerWrapRef.current?.getBoundingClientRect();
    if (r) setListMaxH(Math.max(160, window.innerHeight - r.bottom - 24));
  };

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
  const addFilter = () => apply([...filters, { column: filterCols[0]?.key ?? "", operator: FILTER_OPS[0].value, value: "" }]);
  const removeFilter = (fi) => apply(filters.filter((_, i) => i !== fi));
  // Value edits show instantly; the re-analysis fires once typing pauses
  // (PolarisTextField reports every keystroke).
  const valueTimer = useRef(null);
  useEffect(() => () => clearTimeout(valueTimer.current), []);
  const changeValue = (fi, v) => {
    const next = filters.map((f, i) => (i === fi ? { ...f, value: v } : f));
    setFilters(next);
    clearTimeout(valueTimer.current);
    valueTimer.current = setTimeout(() => onFilters(next), 600);
  };

  return (
    <div style={{ ...entityCard, opacity: included ? 1 : 0.6 }}>
      {/* Header — the whole collapsed card, clickable edge to edge. The
          embedded controls stop propagation so using them doesn't toggle;
          keyboard users toggle via the chevron button. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div style={cardHeader} onClick={() => setOpen((o) => !o)}>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <span style={{ display: "inline-flex", marginRight: ".5rem" }} onClick={(e) => e.stopPropagation()}>
          <PolarisCheckbox
            label={`Include ${name}`}
            labelAccessibilityVisibility="exclusive"
            checked={included}
            onChange={(checked) => onPlan({
              include: checked,
              ...(checked && plan.entity === "ignore" ? { entity: "auto" } : {}),
            })}
            disabled={disabled}
          />
        </span>
        {/* Labeled like the export Data table's column headers. */}
        <div style={{ ...headCol, minWidth: 140 }}>
          <span style={headLabel}>Sheet:</span>
          <span style={{ fontWeight: 700, ...(included ? null : { color: "#8a8a8a" }) }}>{name}</span>
        </div>

        {/* Sheet mapping — popover picker with entity icons, same pattern as
            the export page's Format field. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div style={headCol} onClick={(e) => e.stopPropagation()}>
          <span style={headLabel}>Import as</span>
          <span ref={triggerWrapRef} style={{ width: 210, display: "block" }}>
            <s-clickable
              command="--toggle"
              commandFor={popId}
              onClick={sizeList}
              disabled={disabled ? true : undefined}
              inlineSize="100%"
              borderWidth="base"
              borderStyle="solid"
              borderColor="strong"
              borderRadius="base"
              paddingInline="small-100"
              blockSize="32px"
              background="base"
            >
              <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
                {/* Icon + label share one span with the popover rows' .4rem
                    gap, so trigger and rows space identically. */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", minWidth: 0 }}>
                  <s-icon type={entityOption.icon} />
                  <span style={{ ...ellipsis, fontWeight: 700 }}>{entityOption.label}</span>
                </span>
                <s-icon type="select" />
              </s-grid>
            </s-clickable>
            <s-popover id={popId} {...widthProps(240)}>
              {/* 34 rows — the list scrolls inside the popover, reaching to
                  the bottom of the page. */}
              <div className="entity-pop-list" style={{ maxHeight: listMaxH, overflowY: "auto" }}>
                <s-box padding="small-200">
                  <s-stack direction="block" gap="small-300">
                    {ENTITY_OPTIONS.map((o) => (
                      <PickerRow
                        key={o.value}
                        label={o.label}
                        icon={<s-icon type={o.icon} />}
                        selected={plan.entity === o.value}
                        onSelect={() => onPlan({ entity: o.value, include: o.value !== "ignore" })}
                        popoverId={popId}
                      />
                    ))}
                  </s-stack>
                </s-box>
              </div>
            </s-popover>
          </span>
        </div>

        <div style={cardHeaderInfo}>
          {sheet.ok && sheet.records != null && (
            <s-badge>
              {sheet.records.toLocaleString()} {entityDisplayName(sheet.entity ?? "").toLowerCase() || "records"}
            </s-badge>
          )}
          <s-badge tone="info">
            {sheet.ok ? `${(sheet.parsed ?? 0).toLocaleString()} rows` : "— rows"}
          </s-badge>
          {!included
            ? <s-badge>Skipped</s-badge>
            : sheet.ok
              ? <s-badge tone="success">Ready</s-badge>
              : <s-badge tone="warning">Not importable</s-badge>}
        </div>
        {/* Chevron toggles too; stops propagation so the header's own
            onClick doesn't also fire (which would cancel the toggle). */}
        <s-button
          variant="tertiary"
          icon={open ? "chevron-up" : "chevron-down"}
          accessibilityLabel={open ? "Collapse" : "Expand"}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        />
      </div>

      {open && (
        <div style={entityCardBody}>
          <s-stack direction="block" gap="base">

            {/* Counts / status line */}
            {included ? (
              sheet.ok ? (
                <div style={sheetMeta}>
                  <s-text color="subdued">
                    {sheet.records != null
                      ? `${sheet.records.toLocaleString()} items from ${sheet.parsed.toLocaleString()} rows`
                      : `${sheet.parsed.toLocaleString()} rows`}
                    {sheet.detection?.via ? ` · detected by ${sheet.detection.via}` : ""}
                  </s-text>
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

            {/* Columns — tick which ones to import (untick = leave field untouched) */}
            {included && sheet.ok && columns.length > 0 && (
              <s-stack direction="block" gap="small-200">
                <span style={sectionHeader}>
                  {columns.length} columns
                  {unknownCount > 0 && ` · ${unknownCount} unrecognized`}
                  {excludedCount > 0 && ` · ${excludedCount} excluded`}
                </span>
                {/* Polaris checkboxes in the export page's column grid — all
                    visible, no inner scroll. */}
                <div style={colGrid}>
                  {columns.map((c, i) => {
                    const key = filterCols[i]?.key ?? c.name;
                    const on = isSelected(key);
                    return (
                      <span
                        key={i}
                        style={{ ...(c.known ? chip : chipUnknown), opacity: on ? 1 : 0.6 }}
                        title={c.known ? "" : "Unrecognized column — imported as custom data"}
                      >
                        {/* Not disabled while re-analyzing — ticks apply to
                            the plan instantly; the analysis only refreshes
                            counts, and the debounced submit batches bursts.
                            Locked (with everything else) once an import runs. */}
                        <PolarisCheckbox
                          label={c.known ? c.name : `${c.name} (unrecognized)`}
                          checked={on}
                          onChange={() => toggleColumn(key)}
                          disabled={disabled}
                        />
                      </span>
                    );
                  })}
                </div>
              </s-stack>
            )}

            {/* Row filters (only import records matching these conditions) */}
            {included && sheet.ok && filterCols.length > 0 && (
              <>
                <hr style={sectionRule} />
                <s-stack direction="block" gap="small-200">
                  <span style={sectionHeader}>
                    Row filters{filters.length ? ` (${filters.length})` : ""}
                    {sheet.filteredOut > 0 && ` · ${sheet.filteredOut} rows excluded`}
                  </span>
                  {filters.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                      {filters.map((f, fi) => {
                        const valueless = VALUELESS_OPS.has(f.operator);
                        return (
                          <div key={fi} style={advFilterRow}>
                            <PolarisSelect label="Column" labelAccessibilityVisibility="exclusive" value={f.column} onChange={(v) => change(fi, { column: v }, true)} disabled={disabled}>
                              {filterCols.map((c) => <s-option key={c.key} value={c.key}>{c.label}</s-option>)}
                            </PolarisSelect>
                            <PolarisSelect label="Condition" labelAccessibilityVisibility="exclusive" value={f.operator} onChange={(v) => change(fi, { operator: v }, true)} disabled={disabled}>
                              {FILTER_OPS.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
                            </PolarisSelect>
                            <PolarisTextField
                              label="Value"
                              labelAccessibilityVisibility="exclusive"
                              value={valueless ? "" : f.value}
                              onChange={(v) => changeValue(fi, v)}
                              placeholder={valueless ? "—" : "value"}
                              disabled={disabled || valueless}
                            />
                            <s-clickable
                              accessibilityLabel="Remove filter"
                              onClick={() => removeFilter(fi)}
                              disabled={disabled ? true : undefined}
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
                    <s-button icon="plus" variant="secondary" onClick={addFilter} disabled={disabled}>
                      Add filter
                    </s-button>
                  </div>
                </s-stack>
              </>
            )}
          </s-stack>
        </div>
      )}
    </div>
  );
}

/** One run fact: small uppercase label over its value (the run page's). */
function Fact({ label, children, span, style }) {
  return (
    <div style={{ minWidth: 120, ...(span ? { gridColumn: `span ${span}` } : null), ...style }}>
      <s-stack direction="block" gap="small-500">
        <span style={factLabel}>{label}</span>
        <span style={factValue}>{children}</span>
      </s-stack>
    </div>
  );
}
/* eslint-enable react/prop-types */

// ─── styles ──────────────────────────────────────────────────────────────────

// Card titles hand-rolled (instead of s-section heading) so Sheets and
// Options read identically — same treatment as the export page.
const sheetsHeader = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: "1rem", flexWrap: "wrap",
};
const sheetsTitle = {
  fontSize: "0.875rem", fontWeight: 650,
};
const ellipsis = {
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
// Options card rows — the export page's Advanced card layout: 160px label
// column, field body beside it.
const advRow = {
  display: "grid", gridTemplateColumns: "160px minmax(0, 1fr)",
  gap: "1rem", alignItems: "start",
};
const advRowLabel = {
  fontSize: ".8125rem", fontWeight: 600, paddingTop: ".35rem",
};
const advRowBody = {
  display: "flex", flexDirection: "column", gap: ".85rem", maxWidth: 520,
};
// Scheduling row runs wider than the other rows (date + time + timezone).
const schedRowBody = {
  display: "flex", flexDirection: "column", gap: ".85rem", maxWidth: 720,
};
const schedGrid = {
  display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: ".75rem", maxWidth: 640,
};
// Field + its helper text as one tight unit.
const fieldHelpWrap = {
  display: "flex", flexDirection: "column", gap: 4,
};
// Behavior checkboxes: a single column, all vertically aligned.
const behaviorGrid = {
  display: "flex", flexDirection: "column", gap: ".25rem", alignItems: "flex-start",
};
// Information card facts (the run page's): small uppercase label + value.
const factLabel = {
  fontSize: ".6875rem", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: ".04em", color: "#8a9199",
};
// nowrap keeps the file name on one line; the 5-column grid gives it room.
const factValue = { fontSize: ".875rem", whiteSpace: "nowrap" };
const mutedValue = { color: "#8a9199" };
// Import-file value: name (ellipsizes) + size (never shrinks) on one line.
const fileValueRow = { display: "flex", alignItems: "baseline", minWidth: 0, maxWidth: "100%" };
const fileNameCell = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// Format icon + name as one inline unit in the status row.
const formatLabelWrap = {
  display: "inline-flex", alignItems: "center", gap: ".35rem", verticalAlign: "middle",
};
// Per-sheet expandable card — same look as the export page's entity cards.
const entityCard = {
  background: "#ffffff", border: "1px solid #e3e5e7", borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.05)", overflow: "hidden",
};
const entityCardBody = { padding: "0 1rem 1rem" };
const cardHeader = {
  display: "flex", alignItems: "center", gap: ".5rem", cursor: "pointer",
  // Exactly 60px tall, edge to edge — the collapsed card IS this band.
  height: 60, paddingInline: "1rem", boxSizing: "border-box",
};
const cardHeaderInfo = {
  marginLeft: "auto", display: "flex", flexDirection: "row",
  alignItems: "center", gap: ".25rem",
};
const sectionHeader = {
  fontSize: ".78rem", fontWeight: 600, color: "#6d7175",
};
// Label + value on one line inside the card header; the label matches the
// export Data table's column-header text (sheetTh there).
const headCol = {
  display: "flex", flexDirection: "row", gap: ".5rem", alignItems: "center",
};
const headLabel = {
  fontSize: ".75rem", fontWeight: 600, color: "#616a75", whiteSpace: "nowrap",
};
const sectionRule = {
  border: 0, borderTop: "1px solid #f1f2f3", margin: 0, width: "100%",
};
// Run facts inside the finished banner: label column + value column.
// Options accordion header — the whole band toggles, edge to edge.
const optionsHeader = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: "1rem", cursor: "pointer", padding: ".65rem 1rem",
};
const sheetMeta = {
  display: "flex", alignItems: "center", gap: ".6rem", marginTop: ".5rem", flexWrap: "wrap",
};
// One filter row: column · condition · value · trash button — the export
// page's advFilterRow layout.
const advFilterRow = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1.3fr) minmax(150px, 1.3fr) minmax(140px, 1.6fr) auto",
  gap: ".5rem",
  alignItems: "end",
};
const squareIconBox = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: "100%", height: "100%",
};
// Column checkboxes flow inline and wrap (the old chips' sequence), with no
// scroll cap so every column is visible.
const colGrid = {
  display: "flex", flexWrap: "wrap", gap: ".35rem", alignItems: "center",
  // s-checkbox sets its own label size inside its shadow DOM, out of CSS
  // reach — zoom scales the whole chip (box + label) down instead.
  zoom: 0.85,
};
// Chip pill around each column checkbox — amber marks unrecognized columns.
const chip = {
  display: "inline-flex", alignItems: "center",
  fontSize: ".75rem", padding: ".15rem .6rem", borderRadius: 999,
  background: "#f1f2f3", color: "#42474c", whiteSpace: "nowrap",
};
const chipUnknown = {
  ...chip, background: "#fff4e4", color: "#8a6116", border: "1px solid #ffd79d",
};
