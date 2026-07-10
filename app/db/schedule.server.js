/**
 * db/schedule.server.js
 *
 * Recurring exports/imports. A tick (every minute, from queue/init) runs any
 * schedule whose nextRunAt has passed: it creates a normal export/import job so
 * the run appears in Recent activity, then advances nextRunAt. All cadence math
 * is in UTC (the UI shows job times in UTC too).
 */

import db from "../db.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export async function listSchedules(shop) {
  return db.schedule.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}

export async function createSchedule(data) {
  const sch = { ...data };
  sch.nextRunAt = computeNextRun(sch, new Date());
  return db.schedule.create({ data: sch });
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

// ─── Cadence ────────────────────────────────────────────────────────────────────

/**
 * Next run Date (UTC) at/after `from` for a schedule's cadence.
 * @param {{frequency:string,hour?:number,minute?:number,weekday?:number,monthday?:number}} sch
 */
export function computeNextRun(sch, from = new Date()) {
  const hour = clampInt(sch.hour, 0, 23, 3);
  const minute = clampInt(sch.minute, 0, 59, 0);

  if (sch.frequency === "hourly") {
    const next = new Date(Date.UTC(
      from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours(), minute, 0, 0,
    ));
    if (next <= from) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  if (sch.frequency === "weekly") {
    const wd = clampInt(sch.weekday, 0, 6, 1);
    let next = atTime(from, hour, minute);
    for (let i = 0; i < 8; i++) {
      if (next.getUTCDay() === wd && next > from) return next;
      next = atTime(new Date(next.getTime() + DAY_MS), hour, minute);
    }
    return next;
  }

  if (sch.frequency === "monthly") {
    const md = clampInt(sch.monthday, 1, 31, 1);
    let next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), md, hour, minute, 0, 0));
    if (next <= from) next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, md, hour, minute, 0, 0));
    return next;
  }

  // daily (default)
  let next = atTime(from, hour, minute);
  if (next <= from) next = new Date(next.getTime() + DAY_MS);
  return next;
}

const atTime = (d, h, m) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0, 0));
const clampInt = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
};

// ─── Execution ────────────────────────────────────────────────────────────────

/** Kick off one schedule's run (creates a job that lands in Recent activity). */
export async function runSchedule(sch) {
  if (sch.type === "export") {
    const { unauthenticated } = await import("../shopify.server.js");
    const { startExport } = await import("../export/exportJob.js");
    // A preset's spec (filters + columns) drives the run when present; otherwise
    // export the chosen entities with all fields.
    let specs = null;
    if (sch.spec) { try { specs = JSON.parse(sch.spec); } catch { specs = null; } }
    if (!Array.isArray(specs) || !specs.length) {
      const entities = String(sch.entity || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!entities.length) return;
      specs = entities.map((entity) => ({ entity, filters: {}, fields: null }));
    }
    const { admin } = await unauthenticated.admin(sch.shop);
    await startExport({ admin, shop: sch.shop, specs, format: sch.format || "csv" });
    return;
  }

  // import — re-run the schedule's stored source file with its saved plan + mode.
  if (!sch.sourceR2Key) return;
  const { createImportJob } = await import("./bulkImportJob.server.js");
  const { enqueueImport } = await import("../queue/importQueue.server.js");
  let plan = null, options = null;
  try { plan = sch.plan ? JSON.parse(sch.plan) : null; } catch { plan = null; }
  try { options = sch.options ? JSON.parse(sch.options) : null; } catch { options = null; }
  const job = await createImportJob({
    shop: sch.shop,
    entity: sch.entity || "",
    format: sch.format || "csv",
    filename: sch.filename ?? null,
    sourceR2Key: sch.sourceR2Key,
    progressTotal: null,
    plan, options,
  });
  await enqueueImport({ jobId: job.id, shop: sch.shop, plan, options: options ?? {} });
}

/** Run a single schedule immediately (Run now) without disturbing its cadence. */
export async function runScheduleNow(shop, id) {
  const sch = await db.schedule.findFirst({ where: { id, shop } });
  if (!sch) return null;
  await runSchedule(sch);
  return db.schedule.update({ where: { id }, data: { lastRunAt: new Date() } });
}

/** Run every schedule that's due; advance each to its next slot. */
export async function runDueSchedules() {
  const now = new Date();
  const due = await db.schedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  for (const sch of due) {
    try {
      await runSchedule(sch);
    } catch (err) {
      console.error(`[scheduler] schedule ${sch.id} failed:`, err.message);
    }
    await db.schedule.update({
      where: { id: sch.id },
      data: { lastRunAt: now, nextRunAt: computeNextRun(sch, new Date(now.getTime() + 1000)) },
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
