// Phase 4 — verify the newly built features end to end through the real
// pipeline: new entities export, Shopify CSV dialect, file splitting,
// sub-hourly cadence math, and content-hash change detection.
import fs from "node:fs";
import { queueExport, waitJob, downloadR2, record, summary, results } from "./lib.mjs";

const spec = (entity, extra = {}) => [{ entity, filters: {}, fields: null, ...extra }];

async function runExport(name, { specs, format, splitRows = null }, validate) {
  try {
    const id = await queueExport({ specs, format, splitRows });
    const job = await waitJob("export", id);
    if (job.status !== "complete") return record(name, false, job.errorMessage || job.status);
    const buffer = job.r2Key ? await downloadR2(job.r2Key) : null;
    if (!buffer?.length) return record(name, false, "no file produced");
    record(name, true, (await validate?.(buffer, job)) ?? `${buffer.length} bytes`);
  } catch (e) {
    record(name, false, e.message.slice(0, 160));
  }
}

const headerOnlyOk = async (b) => {
  const lines = b.toString("utf8").trim().split("\n");
  return `${lines[0].split(",").length} cols, ${lines.length - 1} rows`;
};

// ── 1. the new entities, end to end ──────────────────────────────────────────
for (const e of ["inventory", "product_media", "segments", "markets", "delivery_profiles", "selling_plans", "store_credit", "metafields"]) {
  await runExport(`export ${e}`, { specs: spec(e), format: "csv" }, headerOnlyOk);
}

// ── 2. Shopify-native CSV dialect ────────────────────────────────────────────
await runExport("products as Shopify CSV", { specs: spec("products"), format: "csv_shopify" }, async (b) => {
  const header = b.toString("utf8").split("\n")[0].trim();
  const want = ["Handle", "Title", "Body (HTML)", "Variant SKU", "Variant Price", "Status"];
  const missing = want.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`missing Shopify columns: ${missing.join(", ")}`);
  return `Shopify layout: ${header.split(",").length} columns`;
});
await runExport("customers as Shopify CSV", { specs: spec("customers"), format: "csv_shopify" }, async (b) => {
  const header = b.toString("utf8").split("\n")[0].trim();
  if (!header.startsWith("First Name,Last Name,Email")) throw new Error(`header: ${header.slice(0, 80)}`);
  return "Shopify customer layout";
});

// ── 3. file splitting ────────────────────────────────────────────────────────
await runExport("products split into 25-row parts", { specs: spec("products"), format: "csv", splitRows: 25 }, async (b) => {
  const { unzip } = await import("../app/import/parsers/unzip.js");
  const names = [...unzip(b).keys()];
  if (names.length < 2) throw new Error(`expected several parts, got ${names.join(", ")}`);
  // Every part must carry its own header row.
  const entries = [...unzip(b).entries()];
  for (const [n, data] of entries) {
    const first = data.toString("utf8").split("\n")[0];
    if (!/ID|Handle|Title/i.test(first)) throw new Error(`${n} has no header row`);
  }
  return `${names.length} parts: ${names.slice(0, 3).join(", ")}…`;
});

// ── 4. cadence math for the sub-hourly frequencies ───────────────────────────
{
  const { computeNextRun } = await import("../app/db/schedule.server.js");
  const from = new Date("2026-07-27T10:07:00Z");
  const q = computeNextRun({ frequency: "every15min" }, from);
  const h = computeNextRun({ frequency: "every30min" }, from);
  const rollover = computeNextRun({ frequency: "every30min" }, new Date("2026-07-27T10:47:00Z"));
  const ok = q.toISOString() === "2026-07-27T10:15:00.000Z"
    && h.toISOString() === "2026-07-27T10:30:00.000Z"
    && rollover.toISOString() === "2026-07-27T11:00:00.000Z";
  record("sub-hourly cadence math", ok, `15m→${q.toISOString().slice(11, 16)}, 30m→${h.toISOString().slice(11, 16)}, rollover→${rollover.toISOString().slice(11, 16)}`);
}

// ── 5. content-hash change detection ─────────────────────────────────────────
{
  const { rememberedFiles, alreadyImported } = await import("../app/db/schedule.server.js");
  const remembered = rememberedFiles(JSON.stringify([{ n: "feed.csv", h: "aaa" }]));
  const same = alreadyImported(remembered, "feed.csv", "aaa");
  const changed = alreadyImported(remembered, "feed.csv", "bbb");
  record("content-hash detection", same && !changed, `unchanged skipped=${same}, overwritten re-imports=${!changed}`);
}

summary(fs, new URL("./phase4-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
