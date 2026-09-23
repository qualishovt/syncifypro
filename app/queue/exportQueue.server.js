/**
 * queue/exportQueue.server.js
 *
 * Durable export queue on pg-boss (Postgres-backed — no Redis). Replaces the
 * fire-and-forget in-process export processing with a persisted job: if the
 * server restarts mid-export, pg-boss re-delivers the job to a worker instead
 * of orphaning it.
 *
 * Single-process model: the web server IS the worker (the worker is registered
 * at boot via queue/init.server.js). pg-boss stores its own state in a
 * `pgboss` schema in the same Postgres database.
 *
 * The worker reconstructs an admin API client from the shop's stored OFFLINE
 * session (unauthenticated.admin) — it has no request context of its own.
 */

import { PgBoss } from "pg-boss";
import { unauthenticated } from "../shopify.server.js";

export const EXPORT_QUEUE = "export";

let bossPromise = null;

async function startBoss() {
  const boss = new PgBoss(process.env.DATABASE_URL);
  boss.on("error", (err) => console.error("[pg-boss] error:", err));
  await boss.start();
  await boss.createQueue(EXPORT_QUEUE);

  // Register the worker. Handler receives a batch (default size 1).
  await boss.work(EXPORT_QUEUE, async ([job]) => {
    const { jobId, specs, format, shop, options } = job.data;
    // Dynamic import breaks the exportJob ↔ queue import cycle.
    const { runExportForJob } = await import("../export/exportJob.js");
    const { admin } = await unauthenticated.admin(shop);
    await runExportForJob({ admin, shop, jobId, specs, format, options: options ?? {} });
  });

  return boss;
}

/** Start pg-boss + register the worker once; reused across calls. */
export function getBoss() {
  if (!bossPromise) bossPromise = startBoss();
  return bossPromise;
}

/**
 * Enqueue an export for durable, off-request processing.
 * @param {{ jobId: string, specs: object[], format: string, shop: string }} data
 */
export async function enqueueExport(data) {
  const boss = await getBoss();
  await boss.send(EXPORT_QUEUE, data);
}
