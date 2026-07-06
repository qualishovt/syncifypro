/**
 * queue/init.server.js
 *
 * One-time background init, run at server boot (imported from entry.server).
 *   1. Fail orphaned in-process export jobs left over from a previous crash.
 *   2. Start pg-boss + register the export worker so pending/queued jobs are
 *      picked up (and future exports are processed durably).
 *
 * Guarded so it runs once per process even if the module is re-imported.
 */

import { getBoss } from "./exportQueue.server.js";
import { getImportBoss } from "./importQueue.server.js";
import { failStaleJobs } from "../db/bulkExportJob.server.js";
import { failStaleImportJobs } from "../db/bulkImportJob.server.js";

let started = false;

export function initBackground() {
  if (started) return;
  started = true;

  failStaleJobs()
    .then((n) => { if (n) console.warn(`[export] marked ${n} stale job(s) as failed on startup`); })
    .catch((err) => console.error("[export] failStaleJobs error:", err.message));

  failStaleImportJobs()
    .then((n) => { if (n) console.warn(`[import] marked ${n} stale job(s) as failed on startup`); })
    .catch((err) => console.error("[import] failStaleImportJobs error:", err.message));

  getBoss()
    .then(() => console.info("[pg-boss] export worker ready"))
    .catch((err) => console.error("[pg-boss] failed to start:", err.message));

  getImportBoss()
    .then(() => console.info("[pg-boss] import worker ready"))
    .catch((err) => console.error("[pg-boss] import worker failed to start:", err.message));
}
