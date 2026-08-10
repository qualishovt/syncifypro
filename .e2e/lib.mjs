// Shared helpers for the comprehensive E2E campaign (temporary — delete after).
// Jobs are enqueued on the app's real pg-boss queues; the RUNNING DEV SERVER's
// workers process them, so every run lands in Recent activity like a UI run.
import { PgBoss } from "pg-boss";

export const SHOP = "dataengine.myshopify.com";

export const app = (p) => import(`../app/${p}`);

let _db, _boss, _token;

export async function db() {
  if (!_db) _db = (await app("db.server.js")).default;
  return _db;
}

export async function boss() {
  if (!_boss) {
    _boss = new PgBoss(process.env.DATABASE_URL);
    _boss.on("error", () => {});
    await _boss.start();
  }
  return _boss;
}

/**
 * Admin GraphQL via the APP's own client — offline tokens now EXPIRE, and
 * unauthenticated.admin() refreshes them; a raw stored token goes stale.
 */
let _admin;
export async function admin() {
  if (!_admin) {
    const { unauthenticated } = await app("shopify.server.js");
    _admin = (await unauthenticated.admin(SHOP)).admin;
  }
  return _admin;
}

export async function gql(query, variables) {
  const a = await admin();
  const res = await a.graphql(query, variables ? { variables } : undefined);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(JSON.stringify(errors).slice(0, 300));
  return data;
}

/** Enqueue a real EXPORT job (same shape as startTrackedExport). */
export async function queueExport({ specs, format, splitRows = null }) {
  const { createBulkExportJob } = await app("db/bulkExportJob.server.js");
  const job = await createBulkExportJob({
    shop: SHOP,
    entity: specs.map((s) => s.entity).join(","),
    format,
    spec: specs,
    progressTotal: null,
  });
  await (await boss()).send("export", { jobId: job.id, specs, format, shop: SHOP, splitRows });
  return job.id;
}

/** Enqueue a real IMPORT job for a file buffer (staged to R2 like an upload). */
export async function queueImport({ buffer, filename, format, plan = null, options = {} }) {
  const { putToR2 } = await app("export/delivery/r2.js");
  const { createImportJob } = await app("db/bulkImportJob.server.js");
  const key = `imports/${SHOP}/e2e/${Date.now()}-${filename.replace(/[^\w.-]+/g, "_")}`;
  const mime = format === "csv" ? "text/csv" : format === "zip" ? "application/zip"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await putToR2({ buffer, key, mimeType: mime });
  const job = await createImportJob({
    shop: SHOP, entity: "", format, filename, sourceR2Key: key, progressTotal: null,
    plan, options,
  });
  await (await boss()).send("import", { jobId: job.id, shop: SHOP, plan, options });
  return job.id;
}

/** Poll a job row until terminal. */
export async function waitJob(table, id, timeoutMs = 180_000) {
  const d = await db();
  const t = table === "export" ? d.bulkExportJob : d.bulkImportJob;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await t.findUnique({ where: { id } });
    if (job && ["complete", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error("timeout waiting for job");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function downloadR2(key) {
  const { downloadFromR2 } = await app("export/delivery/r2.js");
  return downloadFromR2(key);
}

// ── result collection ────────────────────────────────────────────────────────
export const results = [];
export function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
export function summary(fs, out) {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} passed ===`);
  for (const r of results.filter((x) => !x.ok)) console.log("FAILED:", r.name, "—", r.detail);
  if (fs && out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
}
