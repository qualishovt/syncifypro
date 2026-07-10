/**
 * queue/importQueue.server.js
 *
 * Durable import queue on pg-boss — the write-side twin of exportQueue. The web
 * server IS the worker (registered at boot from queue/init.server.js). Enqueuing
 * an import persists the job so a mid-import restart re-delivers it rather than
 * orphaning the upload.
 *
 * The worker has no request context, so it rebuilds an admin client from the
 * shop's stored OFFLINE session (unauthenticated.admin), downloads the staged
 * file from R2, and runs the import.
 */

import { PgBoss } from "pg-boss";
import { unauthenticated } from "../shopify.server.js";

export const IMPORT_QUEUE = "import";

let bossPromise = null;

async function startBoss() {
  const boss = new PgBoss(process.env.DATABASE_URL);
  boss.on("error", (err) => console.error("[pg-boss] import error:", err));
  await boss.start();
  await boss.createQueue(IMPORT_QUEUE);

  await boss.work(IMPORT_QUEUE, async ([job]) => {
    const { jobId, shop, plan, options } = job.data;
    // Dynamic import avoids an importJob ↔ queue module cycle.
    const { runImportForJob } = await import("../import/importJob.js");
    const { admin } = await unauthenticated.admin(shop);
    await runImportForJob({ admin, shop, jobId, plan, options });
  });

  return boss;
}

/** Start pg-boss + register the import worker once; reused across calls. */
export function getImportBoss() {
  if (!bossPromise) bossPromise = startBoss();
  return bossPromise;
}

/**
 * Enqueue an import for durable, off-request processing.
 * @param {{ jobId: string, shop: string, plan?: Array<{entity?: string, include?: boolean}>, options?: object }} data
 */
export async function enqueueImport(data) {
  const boss = await getImportBoss();
  await boss.send(IMPORT_QUEUE, data);
}
