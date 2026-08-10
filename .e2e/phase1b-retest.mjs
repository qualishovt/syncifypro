// Phase 1b — retest the 8 failed export cells after fixes, plus a sharper
// advanced-filter case. Empty entities must now produce a header-only file.
import fs from "node:fs";
import { queueExport, waitJob, downloadR2, record, summary, results } from "./lib.mjs";

const spec = (entity, extra = {}) => [{ entity, filters: {}, fields: null, ...extra }];

async function runExport(name, { specs, format }, validate) {
  try {
    const id = await queueExport({ specs, format });
    const job = await waitJob("export", id);
    if (job.status !== "complete") return record(name, false, job.errorMessage || job.status);
    const buffer = job.r2Key ? await downloadR2(job.r2Key) : null;
    if (!buffer?.length) return record(name, false, "no file produced");
    const detail = await validate?.(buffer, job);
    record(name, true, detail ?? `${buffer.length} bytes`);
    return { job, buffer };
  } catch (e) {
    record(name, false, e.message.slice(0, 160));
  }
}

const headerOnlyOk = async (b) => {
  const lines = b.toString("utf8").trim().split("\n");
  const cols = lines[0].split(",").length;
  if (cols < 2) throw new Error(`header has ${cols} columns`);
  return `${cols}-column header, ${lines.length - 1} data rows`;
};

for (const e of ["discounts", "content", "articles", "gift_cards", "shop", "payouts", "companies", "inventory_transfers"]) {
  await runExport(`retest export ${e} csv`, { specs: spec(e), format: "csv" }, headerOnlyOk);
}

// Sharper advanced filter: only the "jseh" products should survive.
await runExport("advanced filter (title contains jseh)", {
  specs: spec("products", { advancedFilters: [{ column: "title", operator: "contains", value: "jseh" }] }),
  format: "csv",
}, async (b, job) => {
  if (job.rowCount >= 117) throw new Error(`not filtered: ${job.rowCount}`);
  return `filtered 117 → ${job.rowCount} rows`;
});

summary(fs, new URL("./phase1b-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
