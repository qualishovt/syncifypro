/**
 * db/cleanup.server.js
 *
 * File retention: deletes a job's downloadable files from R2 once they're older
 * than the shop's chosen retention window (Settings → default 7 days, 0 = never).
 * The job ROW is kept — so history, the job number, and the outcome counts stay;
 * only the download links go away (they render as "—" afterwards). This mirrors
 * how Matrixify / Altera expire old job files while keeping the jobs list.
 *
 * Runs on server boot and once a day (single-process web server = worker).
 */

import db from "../db.server.js";
import { deleteFromR2 } from "../export/delivery/r2.js";
import { getAppSettings } from "./appSettings.server.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function distinctShops() {
  const [e, i] = await Promise.all([
    db.bulkExportJob.findMany({ select: { shop: true }, distinct: ["shop"] }),
    db.bulkImportJob.findMany({ select: { shop: true }, distinct: ["shop"] }),
  ]);
  return [...new Set([...e, ...i].map((r) => r.shop))];
}

async function deleteKeys(keys) {
  for (const key of keys) {
    if (!key) continue;
    try { await deleteFromR2(key); } catch { /* already gone / R2 not configured */ }
  }
}

/**
 * Delete expired job files from R2 (keeping the rows). Returns how many jobs
 * had files removed.
 */
export async function runFileCleanup() {
  let cleaned = 0;
  for (const shop of await distinctShops()) {
    const { retentionDays } = await getAppSettings(shop);
    if (!retentionDays || retentionDays <= 0) continue; // "never delete"
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

    // Exports — the export file.
    const exps = await db.bulkExportJob.findMany({
      where: { shop, createdAt: { lt: cutoff }, NOT: { r2Key: null } },
      select: { id: true, r2Key: true },
    });
    for (const j of exps) {
      await deleteKeys([j.r2Key]);
      await db.bulkExportJob.update({
        where: { id: j.id },
        data: { r2Key: null, signedUrl: null, signedUrlExpiry: null },
      });
      cleaned++;
    }

    // Imports — the uploaded source file + the results workbook.
    const imps = await db.bulkImportJob.findMany({
      where: {
        shop, createdAt: { lt: cutoff },
        OR: [{ NOT: { sourceR2Key: null } }, { NOT: { resultR2Key: null } }],
      },
      select: { id: true, sourceR2Key: true, resultR2Key: true },
    });
    for (const j of imps) {
      await deleteKeys([j.sourceR2Key, j.resultR2Key]);
      await db.bulkImportJob.update({
        where: { id: j.id },
        data: { sourceR2Key: null, resultR2Key: null, resultUrl: null, resultUrlExpiry: null },
      });
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * Erase ALL downloadable job files for one shop from R2, now — regardless of
 * age (Settings → Job Files Erasure). Job rows/history/counts are kept; only the
 * download files + their links are removed. Returns how many jobs were cleared.
 */
export async function eraseAllShopFiles(shop) {
  let cleared = 0;

  const exps = await db.bulkExportJob.findMany({
    where: { shop, NOT: { r2Key: null } },
    select: { id: true, r2Key: true },
  });
  for (const j of exps) {
    await deleteKeys([j.r2Key]);
    await db.bulkExportJob.update({
      where: { id: j.id },
      data: { r2Key: null, signedUrl: null, signedUrlExpiry: null },
    });
    cleared++;
  }

  const imps = await db.bulkImportJob.findMany({
    where: { shop, OR: [{ NOT: { sourceR2Key: null } }, { NOT: { resultR2Key: null } }] },
    select: { id: true, sourceR2Key: true, resultR2Key: true },
  });
  for (const j of imps) {
    await deleteKeys([j.sourceR2Key, j.resultR2Key]);
    await db.bulkImportJob.update({
      where: { id: j.id },
      data: { sourceR2Key: null, resultR2Key: null, resultUrl: null, resultUrlExpiry: null },
    });
    cleared++;
  }

  return cleared;
}

let scheduled = false;

/** Run cleanup now (boot) and then once a day. Guarded to run once per process. */
export function scheduleFileCleanup() {
  if (scheduled) return;
  scheduled = true;
  const tick = () => runFileCleanup()
    .then((n) => { if (n) console.info(`[cleanup] expired files removed for ${n} job(s)`); })
    .catch((err) => console.error("[cleanup] error:", err.message));
  tick();
  const timer = setInterval(tick, DAY_MS);
  timer.unref?.(); // don't keep the process alive just for the timer
}
