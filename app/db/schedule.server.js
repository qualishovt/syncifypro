/**
 * db/schedule.server.js
 *
 * Recurring exports/imports. A tick (every minute, from queue/init) runs any
 * schedule whose nextRunAt has passed: it creates a normal export/import job so
 * the run appears in Recent activity, then advances nextRunAt. Cadence math
 * runs on the schedule's own clock (its IANA timezone); nextRunAt is UTC.
 */

import { createHash } from "node:crypto";
import db from "../db.server.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.server.js";

// Sentinel the UI sends back for an unchanged stored secret, so real secrets
// never round-trip to the browser.
export const SECRET_KEPT = "________";

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export async function listSchedules(shop) {
  return db.schedule.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}

export async function createSchedule(data) {
  const sch = { ...data };
  sch.destinations = encryptDestinations(sch.destinations, null);
  sch.nextRunAt = computeNextRun(sch, new Date());
  return db.schedule.create({ data: sch });
}

export async function updateSchedule(shop, id, data) {
  const existing = await db.schedule.findFirst({ where: { id, shop } });
  if (!existing) return null;
  const sch = { ...data };
  sch.destinations = encryptDestinations(sch.destinations, existing.destinations);
  sch.nextRunAt = computeNextRun({ ...existing, ...sch }, new Date());
  return db.schedule.update({ where: { id }, data: sch });
}

export async function deleteSchedule(shop, id) {
  await db.schedule.deleteMany({ where: { id, shop } });
}

export async function setScheduleEnabled(shop, id, enabled) {
  const sch = await db.schedule.findFirst({ where: { id, shop } });
  if (!sch) return null;
  const nextRunAt = enabled ? computeNextRun(sch, new Date()) : sch.nextRunAt;
  return db.schedule.update({ where: { id }, data: { enabled, nextRunAt } });
}

export async function listScheduleRuns(shop, take = 100) {
  return db.scheduleRun.findMany({ where: { shop }, orderBy: { runAt: "desc" }, take });
}

// ─── Destinations ──────────────────────────────────────────────────────────────

/**
 * Parse a schedule's destinations JSON with secrets DECRYPTED (for delivery).
 * Returns {} when unset/unparseable.
 */
export function readDestinations(schedule) {
  const d = parseDestinations(schedule?.destinations);
  if (!d) return {};
  if (d.ftp?.password) d.ftp.password = decryptSecret(d.ftp.password);
  if (d.s3?.secretAccessKey) d.s3.secretAccessKey = decryptSecret(d.s3.secretAccessKey);
  return d;
}

/**
 * Client-safe destinations: stored secrets are replaced with the SECRET_KEPT
 * sentinel (the UI round-trips it to mean "leave unchanged").
 */
export function serializeDestinations(schedule) {
  const d = parseDestinations(schedule?.destinations);
  if (!d) return {};
  if (d.ftp?.password) d.ftp.password = SECRET_KEPT;
  if (d.s3?.secretAccessKey) d.s3.secretAccessKey = SECRET_KEPT;
  return d;
}

function parseDestinations(raw) {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}

/**
 * Encrypt the secret fields of an incoming destinations JSON string. A value
 * equal to SECRET_KEPT is replaced with the previously stored (already
 * encrypted) secret, so edits don't need to resend passwords.
 */
function encryptDestinations(incoming, storedRaw) {
  const d = parseDestinations(incoming);
  if (!d) return incoming ?? null;
  const stored = parseDestinations(storedRaw);
  const resolve = (value, prior) => {
    if (!value) return "";
    if (value === SECRET_KEPT) return prior || "";
    return encryptSecret(value);
  };
  if (d.ftp) d.ftp.password = resolve(d.ftp.password, stored?.ftp?.password);
  if (d.s3) d.s3.secretAccessKey = resolve(d.s3.secretAccessKey, stored?.s3?.secretAccessKey);
  return JSON.stringify(d);
}

// ─── Cadence ────────────────────────────────────────────────────────────────────

// Next-run maths lives in schedules/nextrun.js (pure, timezone-aware: the
// schedule's hour/minute/weekday/monthday are read in its IANA `timezone`);
// re-exported so existing imports from this module keep working.
import { computeNextRun, isValidTimezone, zonedDateTimeToUtc } from "../schedules/nextrun.js";
export { computeNextRun, isValidTimezone, zonedDateTimeToUtc };

// ─── Execution ────────────────────────────────────────────────────────────────

const JOB_WAIT_MS = 15 * 60 * 1000; // give a run 15 minutes to finish
const JOB_POLL_MS = 2000;

const MIME_BY_FORMAT = {
  csv: "text/csv",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  json: "application/json",
  pdf: "application/pdf",
};
const EXT_BY_FORMAT = { csv: "csv", excel: "xlsx", xml: "xml", json: "json", pdf: "pdf" };

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Delivered-file name for an export schedule. With a template (stored in
 * Schedule.filename for export schedules) the placeholders {date}, {time},
 * {shop} and {name} are filled in; a fixed template (no {date}/{time})
 * overwrites the same remote file on every run — the supplier-feed pattern.
 * Without a template: "<name>-<date>.<ext>". The extension is appended
 * when the template doesn't already carry the right one.
 */
export function renderScheduleFilename(sch, ext, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  // {time} = HHMMSS, no separators — same as the automatic file names.
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const template = String(sch.filename || "").trim();
  let out = template
    ? template
        .replace(/\{date\}/gi, date)
        .replace(/\{time\}/gi, time)
        .replace(/\{shop\}/gi, String(sch.shop || "").replace(/\.myshopify\.com$/i, ""))
        .replace(/\{name\}/gi, slugify(sch.name) || "export")
    : `${slugify(sch.name) || slugify(sch.entity) || "export"}-${date}`;
  out = out.replace(/[\\/:*?"<>|]+/g, "_"); // keep remote filesystems happy
  if (!new RegExp(`\\.${ext}$`, "i").test(out)) out += `.${ext}`;
  return out;
}

/** Human description of what a schedule runs — shown in tables and history. */
export function describeTask(sch) {
  const fmt = String(sch.format || "csv").toUpperCase();
  if (sch.type === "import") {
    if (sch.sourceUrl) return `Import ${sch.filename || "file"} from URL`;
    return `Re-import ${sch.filename || "file"} (${fmt})`;
  }
  const what = String(sch.entity || "").split(",").map((w) => w.trim()).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(", ");
  return `Export ${what || "…"} as ${fmt}`;
}

/**
 * Kick off one schedule's job (it lands in Recent activity like any manual
 * run) and return { jobType, jobId }.
 */
async function startScheduleJob(sch) {
  if (sch.type === "export") {
    const { unauthenticated } = await import("../shopify.server.js");
    const { startExport } = await import("../export/exportJob.js");
    // A preset's spec (filters + columns) drives the run when present; otherwise
    // export the chosen entities with all fields.
    let specs = null;
    if (sch.spec) { try { specs = JSON.parse(sch.spec); } catch { specs = null; } }
    if (!Array.isArray(specs) || !specs.length) {
      const entities = String(sch.entity || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!entities.length) throw new Error("Nothing to export");
      specs = entities.map((entity) => ({ entity, filters: {}, fields: null }));
    }
    // Advanced options snapshotted from the preset (formatting, csv dialect,
    // zip, skip-when-empty, …) apply to scheduled runs too.
    let options = {};
    if (sch.options) { try { options = JSON.parse(sch.options) ?? {}; } catch { options = {}; } }
    const { admin } = await unauthenticated.admin(sch.shop);
    const res = await startExport({
      admin, shop: sch.shop, specs,
      format: sch.format || "csv",
      splitRows: sch.splitRows ?? null,
      options,
    });
    return { jobType: "export", jobId: res.jobId };
  }

  throw new Error("import schedules start via startImportJobs");
}

/** Cap the remembered-files list so the column can't grow unbounded. */
const IMPORTED_FILES_MAX = 1000;

const parseJsonArray = (raw) => {
  try {
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
};

/** sha256 of a file's bytes — identifies CONTENT, not just the name. */
function contentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

/**
 * Remembered imports, normalized to { n: name, h: hash|null }. Legacy rows
 * stored bare filename strings (name-only tracking) — those carry a null
 * hash and still match by name, so upgrading doesn't re-import everything.
 */
export function rememberedFiles(raw) {
  return parseJsonArray(raw).map((e) => (typeof e === "string" ? { n: e, h: null } : e))
    .filter((e) => e && e.n);
}

/**
 * Has this schedule already imported this exact file? A remembered entry
 * matches when the name matches AND (no hash was recorded, or the content
 * hash is identical). So a supplier overwriting the same filename with NEW
 * content re-imports, while an unchanged file is skipped.
 */
export function alreadyImported(remembered, name, hash) {
  return remembered.some((e) => e.n === name && (e.h == null || e.h === hash));
}

/**
 * Kick off an import schedule's job(s). A folder sourceUrl can yield several
 * files (one job each); with onlyNewFiles, files this schedule has imported
 * before are skipped. Returns { jobIds, filenames, skipped }.
 */
async function startImportJobs(sch) {
  const { createImportJob } = await import("./bulkImportJob.server.js");
  const { enqueueImport } = await import("../queue/importQueue.server.js");
  let plan = null, options = null;
  try { plan = sch.plan ? JSON.parse(sch.plan) : null; } catch { plan = null; }
  try { options = sch.options ? JSON.parse(sch.options) : null; } catch { options = null; }

  // Resolve this run's source files.
  let sources; // [{ sourceR2Key, format, filename }]
  if (sch.sourceUrl) {
    const { fetchImportSources } = await import("../import/urlSource.server.js");
    const { putToR2 } = await import("../export/delivery/r2.js");
    let files = await fetchImportSources({ shop: sch.shop, url: sch.sourceUrl });

    // Skip files already imported — matched on name AND content hash, so an
    // overwritten-in-place feed with new contents still imports.
    if (sch.onlyNewFiles) {
      const remembered = rememberedFiles(sch.importedFiles);
      files = files.filter((f) => !alreadyImported(remembered, f.filename, contentHash(f.buffer)));
      if (!files.length) return { jobIds: [], filenames: [], files: [], skipped: true };
    }

    sources = [];
    for (const f of files) {
      const mimeType = f.format === "csv" ? "text/csv"
        : f.format === "zip" ? "application/zip"
        : MIME_BY_FORMAT.excel;
      const safe = f.filename.replace(/[^\w.-]+/g, "_");
      const key = `schedules/${sch.shop}/run-${Date.now()}-${safe}`;
      await putToR2({ buffer: f.buffer, key, mimeType });
      sources.push({ sourceR2Key: key, format: f.format, filename: f.filename, hash: contentHash(f.buffer) });
    }
  } else {
    // Legacy schedule: re-import the stored R2 snapshot.
    if (!sch.sourceR2Key) throw new Error("The schedule's import file is missing");
    sources = [{ sourceR2Key: sch.sourceR2Key, format: sch.format || "csv", filename: sch.filename ?? null }];
  }

  const jobIds = [];
  for (const src of sources) {
    const job = await createImportJob({
      shop: sch.shop,
      entity: sch.entity || "",
      format: src.format,
      filename: src.filename,
      sourceR2Key: src.sourceR2Key,
      progressTotal: null,
      plan, options,
    });
    await enqueueImport({ jobId: job.id, shop: sch.shop, plan, options: options ?? {} });
    jobIds.push(job.id);
  }
  return {
    jobIds,
    filenames: sources.map((s) => s.filename).filter(Boolean),
    files: sources.map((s) => ({ n: s.filename, h: s.hash ?? null })).filter((f) => f.n),
    skipped: false,
  };
}

/** Poll the job row until it's terminal (or timeout). Returns the final row. */
async function waitForJob(jobType, jobId) {
  const table = jobType === "export" ? db.bulkExportJob : db.bulkImportJob;
  const deadline = Date.now() + JOB_WAIT_MS;
  for (;;) {
    const job = await table.findUnique({ where: { id: jobId } });
    if (job && (job.status === "complete" || job.status === "failed" || job.status === "cancelled")) return job;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the job to finish");
    await new Promise((r) => setTimeout(r, JOB_POLL_MS));
  }
}

/**
 * Send the run's file to every enabled destination, collecting per-destination
 * results. One failing doesn't stop the others. With no destinations enabled
 * the file simply stays in the app (Recent activity) — that's a success.
 */
async function deliver(sch, { filename, body, contentType, csvBody }) {
  const dest = readDestinations(sch);
  const parts = [];
  let anyDest = false;
  let failed = false;

  if (dest.email?.enabled) {
    anyDest = true;
    try {
      const { sendScheduleEmail } = await import("../schedules/mailer.server.js");
      const r = await sendScheduleEmail({
        to: dest.email.recipients,
        subject: `${sch.name || describeTask(sch)} — ${filename}`,
        text: `Your scheduled run "${sch.name || describeTask(sch)}" is attached.`,
        attachment: { filename, body, contentType },
      });
      if (r.sent) { parts.push(`Email ✓ (${r.recipients})`); }
      else { parts.push(`Email skipped: ${r.reason || r.error || "not sent"}`); failed = true; }
    } catch (e) {
      parts.push(`Email failed: ${e?.message || e}`);
      failed = true;
    }
  }

  if (dest.ftp?.enabled) {
    anyDest = true;
    try {
      // A serverId points at a saved server (Servers page) — its credentials
      // live encrypted on that row and are resolved here, at delivery time.
      let cfg = dest.ftp;
      if (cfg.serverId) {
        const { getImportServer } = await import("./importServer.server.js");
        const server = await getImportServer(sch.shop, cfg.serverId);
        if (!server) throw new Error("the saved server no longer exists — pick another on the Schedules page");
        cfg = {
          protocol: server.protocol,
          host: server.host,
          port: server.port ?? "",
          user: server.username ?? "",
          password: server.password ?? "",
          path: dest.ftp.path,
        };
      }
      const { uploadToFtp } = await import("../schedules/delivery.server.js");
      await uploadToFtp(cfg, { filename, body });
      parts.push(`${(cfg.protocol || "ftp").toUpperCase()} ✓`);
    } catch (e) {
      parts.push(`FTP failed: ${e?.message || e}`);
      failed = true;
    }
  }

  if (dest.gdrive?.enabled) {
    anyDest = true;
    try {
      const { uploadToDrive } = await import("../schedules/google.server.js");
      const f = await uploadToDrive(sch.shop, {
        filename, body, mimeType: contentType, folderId: dest.gdrive.folderId || "",
      });
      parts.push(`Drive ✓ (${f.name})`);
    } catch (e) {
      parts.push(`Drive failed: ${e?.message || e}`);
      failed = true;
    }
  }

  if (dest.gsheets?.enabled) {
    anyDest = true;
    if (!csvBody) {
      parts.push("Sheets skipped: needs CSV format");
      failed = true;
    } else {
      try {
        const { uploadAsSheet } = await import("../schedules/google.server.js");
        const f = await uploadAsSheet(sch.shop, {
          name: dest.gsheets.name || sch.name || describeTask(sch),
          csv: csvBody,
          folderId: dest.gsheets.folderId || "",
        });
        parts.push(`Sheets ✓ (${f.name})`);
      } catch (e) {
        parts.push(`Sheets failed: ${e?.message || e}`);
        failed = true;
      }
    }
  }

  if (dest.s3?.enabled) {
    anyDest = true;
    try {
      // Saved S3 server: host column = bucket, username = access key id,
      // password = secret (encrypted at rest). Prefix stays per-schedule.
      let cfg = dest.s3;
      if (cfg.serverId) {
        const { getImportServer } = await import("./importServer.server.js");
        const server = await getImportServer(sch.shop, cfg.serverId);
        if (!server) throw new Error("the saved server no longer exists — pick another on the Schedules page");
        cfg = {
          bucket: server.host,
          region: server.region || "us-east-1",
          accessKeyId: server.username ?? "",
          secretAccessKey: server.password ?? "",
          prefix: dest.s3.prefix,
          endpoint: "",
        };
      }
      const { uploadToS3 } = await import("../schedules/delivery.server.js");
      await uploadToS3(cfg, { filename, body, contentType });
      parts.push("S3 ✓");
    } catch (e) {
      parts.push(`S3 failed: ${e?.message || e}`);
      failed = true;
    }
  }

  if (!anyDest) return { summary: "Saved to app (Recent activity)", ok: true };
  return { summary: parts.join("; "), ok: !failed };
}

/** Record a row in the schedule history table (best-effort). */
async function logRun(sch, { status, rows = 0, delivery = "", message = "" }, now) {
  try {
    await db.scheduleRun.create({
      data: {
        shop: sch.shop,
        scheduleId: sch.id,
        scheduleName: sch.name || "",
        task: describeTask(sch),
        status, rows, delivery, message,
        runAt: now,
      },
    });
  } catch {
    // history is best-effort
  }
}

/** Email the shop's notification address about a run, honouring settings. */
async function maybeNotify(sch, { ok, rows = 0, delivery = "", message = "" }) {
  let settings;
  try {
    const { getAppSettings } = await import("./appSettings.server.js");
    settings = await getAppSettings(sch.shop);
  } catch {
    return;
  }
  const to = (settings.notifyEmail || "").trim();
  if (!to) return;
  if (ok && !settings.notifyOnSuccess) return;
  if (!ok && !settings.notifyOnError) return;

  const name = sch.name || describeTask(sch);
  const status = ok ? "succeeded" : "failed";
  const text = [
    `Your scheduled run "${name}" ${status}.`,
    rows ? `Records: ${rows}` : null,
    delivery ? `Delivery: ${delivery}` : null,
    message ? `Details: ${message}` : null,
  ].filter(Boolean).join("\n");
  try {
    const { sendNotificationEmail } = await import("../schedules/mailer.server.js");
    await sendNotificationEmail({ to, subject: `SyncifyPro: schedule "${name}" ${status}`, text });
  } catch {
    // notification is best-effort
  }
}

/**
 * Run one schedule end-to-end. Exports: job → wait → deliver to destinations.
 * Imports: fetch source(s) → one job per file → wait → record. Both log a
 * ScheduleRun history row. Returns { ok, rows, delivery } or { ok, error }.
 */
export async function runSchedule(sch, now = new Date()) {
  try {
    if (sch.type === "import") return await runImportSchedule(sch, now);

    const { jobId } = await startScheduleJob(sch);
    const job = await waitForJob("export", jobId);
    if (job.status !== "complete") {
      const message = job.errorMessage || "Job failed";
      await logRun(sch, { status: "error", message }, now);
      await maybeNotify(sch, { ok: false, message });
      return { id: sch.id, ok: false, error: message };
    }

    const { downloadFromR2 } = await import("../export/delivery/r2.js");
    const rows = job.rowCount ?? 0;
    const ext = /\.zip$/i.test(job.filename || "") ? "zip" : (EXT_BY_FORMAT[sch.format] || "csv");
    const filename = renderScheduleFilename(sch, ext, now);
    const contentType = ext === "zip" ? "application/zip" : (MIME_BY_FORMAT[sch.format] || "application/octet-stream");
    const body = job.r2Key ? await downloadFromR2(job.r2Key) : null;
    const csvBody = sch.format === "csv" && ext === "csv" && body ? body : null;
    if (!body) {
      // Skip-when-empty (a preset option): a 0-row run that intentionally
      // produced no file is a successful no-op, not an error.
      if (rows === 0) {
        await db.schedule.update({ where: { id: sch.id }, data: { lastRunAt: now } });
        await logRun(sch, { status: "ok", rows: 0, delivery: "No data — file skipped" }, now);
        return { id: sch.id, ok: true, rows: 0 };
      }
      const message = "Run produced no file to deliver";
      await logRun(sch, { status: "error", rows, message }, now);
      await maybeNotify(sch, { ok: false, rows, message });
      return { id: sch.id, ok: false, error: message };
    }

    const delivery = await deliver(sch, { filename, body, contentType, csvBody });
    await db.schedule.update({ where: { id: sch.id }, data: { lastRunAt: now } });
    await logRun(sch, { status: delivery.ok ? "ok" : "error", rows, delivery: delivery.summary }, now);
    await maybeNotify(sch, {
      ok: delivery.ok, rows, delivery: delivery.summary,
      message: delivery.ok ? "" : delivery.summary,
    });
    return { id: sch.id, ok: delivery.ok, rows, delivery: delivery.summary };
  } catch (e) {
    const message = e?.message || String(e);
    await logRun(sch, { status: "error", message }, now);
    await maybeNotify(sch, { ok: false, message });
    return { id: sch.id, ok: false, error: message };
  }
}

/** Import runs: possibly several files (folder source), one job per file. */
async function runImportSchedule(sch, now) {
  const { jobIds, filenames, files, skipped } = await startImportJobs(sch);

  if (skipped) {
    const summary = "No new files to import";
    await db.schedule.update({ where: { id: sch.id }, data: { lastRunAt: now } });
    await logRun(sch, { status: "ok", rows: 0, delivery: summary }, now);
    return { id: sch.id, ok: true, rows: 0, delivery: summary };
  }

  let rows = 0;
  const failures = [];
  for (let i = 0; i < jobIds.length; i++) {
    const job = await waitForJob("import", jobIds[i]);
    if (job.status !== "complete") {
      failures.push(`${filenames[i] || "file"}: ${job.errorMessage || "failed"}`);
    } else {
      rows += (job.created ?? 0) + (job.updated ?? 0) + (job.deleted ?? 0);
    }
  }

  // Remember which files this schedule imported, with their content hashes
  // (drives onlyNewFiles). Failed files are NOT remembered, so they retry.
  // A re-imported name replaces its old entry so the hash stays current.
  const failedNames = new Set(failures.map((f) => f.split(":")[0]));
  const imported = (files ?? []).filter((f) => !failedNames.has(f.n));
  if (sch.sourceUrl && imported.length) {
    const importedNames = new Set(imported.map((f) => f.n));
    const merged = [
      ...rememberedFiles(sch.importedFiles).filter((f) => !importedNames.has(f.n)),
      ...imported,
    ].slice(-IMPORTED_FILES_MAX);
    await db.schedule.update({
      where: { id: sch.id },
      data: { lastRunAt: now, importedFiles: JSON.stringify(merged) },
    });
  } else {
    await db.schedule.update({ where: { id: sch.id }, data: { lastRunAt: now } });
  }

  const fileList = filenames.length ? `${filenames.length} file(s): ${filenames.join(", ")}`.slice(0, 500) : "";
  const ok = failures.length === 0;
  const summary = ok ? fileList : `${fileList}${fileList ? " — " : ""}${failures.join("; ")}`.slice(0, 800);
  await logRun(sch, { status: ok ? "ok" : "error", rows, delivery: summary }, now);
  await maybeNotify(sch, { ok, rows, delivery: summary, message: ok ? "" : summary });
  return { id: sch.id, ok, rows, delivery: summary, ...(ok ? {} : { error: failures.join("; ") }) };
}

/** Run a single schedule immediately (Run now) without disturbing its cadence. */
export async function runScheduleNow(shop, id) {
  const sch = await db.schedule.findFirst({ where: { id, shop } });
  if (!sch) return null;
  return runSchedule(sch);
}

/** Run every schedule that's due; advance each to its next slot. */
export async function runDueSchedules() {
  const now = new Date();
  const due = await db.schedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  for (const sch of due) {
    try {
      await runSchedule(sch, now);
    } catch (err) {
      console.error(`[scheduler] schedule ${sch.id} failed:`, err.message);
    }
    // A consumed startAt must not pin future computeNextRun calls; a finite
    // run count ("run N times") counts down and disables at zero.
    const remaining = sch.remainingRuns == null ? null : Math.max(0, sch.remainingRuns - 1);
    await db.schedule.update({
      where: { id: sch.id },
      data: {
        nextRunAt: computeNextRun({ ...sch, startAt: null }, new Date(Date.now() + 1000)),
        ...(sch.startAt ? { startAt: null } : {}),
        ...(remaining == null ? {} : { remainingRuns: remaining, ...(remaining === 0 ? { enabled: false } : {}) }),
      },
    });
  }
  return due.length;
}

let started = false;

/** Poll for due schedules every minute (single-process web server = worker). */
export function scheduleTick() {
  if (started) return;
  started = true;
  const tick = () => runDueSchedules()
    .then((n) => { if (n) console.info(`[scheduler] ran ${n} due schedule(s)`); })
    .catch((err) => console.error("[scheduler] tick error:", err.message));
  tick();
  const timer = setInterval(tick, 60 * 1000);
  timer.unref?.();
}
