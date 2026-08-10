// Phase 1 — export matrix: every entity as CSV; products in all 5 formats;
// filtered, advanced-filtered, and column-selected runs; multi-entity bundles.
import fs from "node:fs";
import { queueExport, waitJob, downloadR2, record, summary, results } from "./lib.mjs";

const ALL_ENTITIES = [
  "products", "orders", "customers", "collections", "smart_collections",
  "custom_collections", "discounts", "content", "articles", "draft_orders",
  "gift_cards", "redirects", "shop", "files", "payouts", "menus", "companies",
  "locations", "catalogs", "inventory_transfers", "activity", "metaobjects",
  "definitions", "translations",
];

const spec = (entity, extra = {}) => [{ entity, filters: {}, fields: null, ...extra }];

async function runExport(name, { specs, format }, validate) {
  try {
    const id = await queueExport({ specs, format });
    const job = await waitJob("export", id);
    if (job.status !== "complete") return record(name, false, job.errorMessage || job.status);
    const buffer = job.r2Key ? await downloadR2(job.r2Key) : null;
    if (!buffer?.length) return record(name, false, "no file produced");
    const detail = await validate?.(buffer, job);
    record(name, true, detail ?? `${job.rowCount ?? "?"} rows, ${buffer.length} bytes`);
    return { job, buffer };
  } catch (e) {
    record(name, false, e.message.slice(0, 160));
  }
}

const isCsv = async (b) => {
  const s = b.toString("utf8");
  const lines = s.trim().split("\n");
  if (!lines[0]?.includes(",") && lines.length > 1) throw new Error("no header row");
  return `${lines.length - 1} data rows`;
};
const isXlsx = async (b) => {
  const { parseXLSX } = await import("../app/import/parsers/xlsx.js");
  const sheets = parseXLSX(b);
  return `${sheets.length} sheet(s): ${sheets.map((x) => `${x.name}(${x.rows.length})`).join(", ")}`;
};
const isJson = async (b) => `${JSON.parse(b.toString("utf8")).length} records`;
const isXml = async (b) => {
  const s = b.toString("utf8");
  if (!s.trimStart().startsWith("<")) throw new Error("not xml");
  return `${(s.match(/<record[ >]|<row[ >]|<product[ >]/gi) ?? []).length || "?"} record tags`;
};
const isPdf = async (b) => {
  if (b.subarray(0, 5).toString() !== "%PDF-") throw new Error("bad magic");
  return `pdf, ${b.length} bytes`;
};
const isZip = async (b) => {
  const { unzip } = await import("../app/import/parsers/unzip.js");
  const names = [...unzip(b).keys()];
  return `zip: ${names.join(", ")}`;
};

// ── 1. every entity as CSV ───────────────────────────────────────────────────
for (const e of ALL_ENTITIES) {
  await runExport(`export ${e} csv`, { specs: spec(e), format: "csv" }, isCsv);
}

// ── 2. products in every format ──────────────────────────────────────────────
await runExport("products xlsx", { specs: spec("products"), format: "excel" }, isXlsx);
await runExport("products json", { specs: spec("products"), format: "json" }, isJson);
await runExport("products xml", { specs: spec("products"), format: "xml" }, isXml);
await runExport("products pdf", { specs: spec("products"), format: "pdf" }, isPdf);

// ── 3. filters ───────────────────────────────────────────────────────────────
const full = await runExport("products csv (baseline count)", { specs: spec("products"), format: "csv" }, isCsv);
await runExport("products csv + status filter", {
  specs: spec("products", { filters: { status: "active" } }), format: "csv",
}, async (b, job) => {
  if (full?.job?.rowCount != null && job.rowCount > full.job.rowCount) throw new Error("filter did not reduce rows");
  return `filtered ${job.rowCount} vs total ${full?.job?.rowCount}`;
});
await runExport("products csv + advanced filter (title contains test)", {
  specs: spec("products", { advancedFilters: [{ column: "title", operator: "contains", value: "test" }] }), format: "csv",
}, async (b, job) => {
  const rows = b.toString("utf8").trim().split("\n").length - 1;
  if (full?.job?.rowCount != null && job.rowCount > full.job.rowCount) throw new Error("adv filter did not reduce rows");
  return `advanced-filtered to ${job.rowCount} rows (${rows} lines)`;
});

// ── 4. column selection ──────────────────────────────────────────────────────
await runExport("products csv + column selection", {
  specs: spec("products", { fields: ["product_id", "handle", "title", "vendor"] }), format: "csv",
}, async (b) => {
  const header = b.toString("utf8").split("\n")[0].trim();
  const cols = header.split(",").map((c) => c.replace(/^"|"$/g, ""));
  if (cols.length !== 4) throw new Error(`expected 4 columns, got ${cols.length}: ${header}`);
  return `columns: ${cols.join(" | ")}`;
});

// ── 5. multi-entity bundles ──────────────────────────────────────────────────
await runExport("multi-entity xlsx workbook", {
  specs: [...spec("products"), ...spec("customers")], format: "excel",
}, async (b) => {
  const detail = await isXlsx(b);
  if (!/2 sheet/.test(detail)) throw new Error(detail);
  return detail;
});
await runExport("multi-entity csv → zip", {
  specs: [...spec("products"), ...spec("customers")], format: "csv",
}, async (b) => {
  const detail = await isZip(b);
  if (!detail.includes("products.csv") || !detail.includes("customers.csv")) throw new Error(detail);
  return detail;
});
await runExport("multi-entity pdf (sections)", {
  specs: [...spec("products"), ...spec("customers")], format: "pdf",
}, isPdf);

summary(fs, new URL("./phase1-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
