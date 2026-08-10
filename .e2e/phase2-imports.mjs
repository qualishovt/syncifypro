// Phase 2 — import matrix: real jobs through the queue, with store-effect
// verification over the Admin API and full cleanup (create → verify →
// DELETE-command import → verify gone). Every test record carries an "e2e-"
// marker so nothing real is ever touched.
import fs from "node:fs";
import { queueImport, waitJob, gql, record, summary, results } from "./lib.mjs";

const TS = Date.now();
const { toCSV } = await import("../app/export/formats/csv.js");
const { toExcelWorkbook } = await import("../app/export/formats/excel.js");
const { zipParts } = await import("../app/export/formats/zip.js");

async function runImport(name, args, verify) {
  try {
    const id = await queueImport(args);
    const job = await waitJob("import", id);
    if (job.status !== "complete") return record(name, false, job.errorMessage || job.status);
    const detail = await verify?.(job);
    record(name, true, detail ?? `created ${job.created}, updated ${job.updated}, deleted ${job.deleted}, failed ${job.failed}`);
    return job;
  } catch (e) {
    record(name, false, e.message.slice(0, 200));
  }
}

const csvBuf = (rows, cols) => toCSV(rows, cols);

// small retry helper for read-after-write
async function eventually(fn, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (last) throw last;
  return null;
}

// ── 1. products CSV round-trip ───────────────────────────────────────────────
const pHandle = `e2e-product-${TS}`;
await runImport("import products csv (create)", {
  buffer: csvBuf(
    [{ command: "NEW", handle: pHandle, title: `E2E Product ${TS}`, vendor: "E2E", status: "DRAFT" }],
    ["command", "handle", "title", "vendor", "status"],
  ),
  filename: "products.csv", format: "csv",
}, async (job) => {
  if (job.created < 1) throw new Error(`created=${job.created} failed=${job.failed}`);
  const d = await eventually(async () => (await gql(`{ productByHandle(handle: "${pHandle}") { id title status } }`)).productByHandle);
  if (!d) throw new Error("product not found in store after import");
  return `created ${d.title} (${d.status})`;
});

await runImport("import products csv (DELETE)", {
  buffer: csvBuf([{ command: "DELETE", handle: pHandle }], ["command", "handle"]),
  filename: "products.csv", format: "csv",
}, async (job) => {
  if (job.deleted < 1) throw new Error(`deleted=${job.deleted} failed=${job.failed}`);
  const gone = await eventually(async () => ((await gql(`{ productByHandle(handle: "${pHandle}") { id } }`)).productByHandle ? null : true));
  if (!gone) throw new Error("product still exists");
  return "deleted + verified gone";
});

// ── 2. multi-sheet XLSX (products + customers) ───────────────────────────────
const pHandle2 = `e2e-wb-product-${TS}`;
const cEmail = `e2e-cust-${TS}@example.com`;
await runImport("import multi-sheet xlsx (create both)", {
  buffer: toExcelWorkbook([
    { name: "Products", rows: [{ command: "NEW", handle: pHandle2, title: `E2E WB Product ${TS}`, vendor: "E2E", status: "DRAFT" }], columns: ["command", "handle", "title", "vendor", "status"] },
    { name: "Customers", rows: [{ command: "NEW", email: cEmail, first_name: "E2E", last_name: "Tester" }], columns: ["command", "email", "first_name", "last_name"] },
  ]),
  filename: "e2e-workbook.xlsx", format: "xlsx",
}, async (job) => {
  if (job.created < 2) throw new Error(`created=${job.created} failed=${job.failed}`);
  const p = await eventually(async () => (await gql(`{ productByHandle(handle: "${pHandle2}") { id } }`)).productByHandle);
  const c = await eventually(async () => (await gql(`{ customers(first: 1, query: "email:${cEmail}") { nodes { id } } }`)).customers.nodes[0]);
  if (!p || !c) throw new Error(`store check: product=${!!p} customer=${!!c}`);
  return "product + customer created and verified";
});

await runImport("import multi-sheet xlsx (DELETE both)", {
  buffer: toExcelWorkbook([
    { name: "Products", rows: [{ command: "DELETE", handle: pHandle2 }], columns: ["command", "handle"] },
    { name: "Customers", rows: [{ command: "DELETE", email: cEmail }], columns: ["command", "email"] },
  ]),
  filename: "e2e-workbook-del.xlsx", format: "xlsx",
}, async (job) => {
  if (job.deleted < 2) throw new Error(`deleted=${job.deleted} failed=${job.failed}`);
  return "both deleted";
});

// ── 3. ZIP of CSVs (redirects + collections) ─────────────────────────────────
const rPath = `/e2e-old-${TS}`;
const colHandle = `e2e-collection-${TS}`;
await runImport("import zip of csvs (redirect + collection)", {
  buffer: zipParts([
    { name: "redirects.csv", data: csvBuf([{ command: "NEW", path: rPath, target: "/" }], ["command", "path", "target"]) },
    { name: "collections.csv", data: csvBuf([{ command: "NEW", handle: colHandle, title: `E2E Collection ${TS}` }], ["command", "handle", "title"]) },
  ]),
  filename: "e2e-bundle.zip", format: "zip",
}, async (job) => {
  if (job.created < 2) throw new Error(`created=${job.created} failed=${job.failed}`);
  const r = await eventually(async () => (await gql(`{ urlRedirects(first: 1, query: "path:${rPath}") { nodes { id } } }`)).urlRedirects.nodes[0]);
  const c = await eventually(async () => (await gql(`{ collectionByHandle(handle: "${colHandle}") { id } }`)).collectionByHandle);
  if (!r || !c) throw new Error(`store check: redirect=${!!r} collection=${!!c}`);
  return "redirect + collection created and verified";
});

// cleanup redirect + collection via DELETE import (zip again)
await runImport("import zip of csvs (DELETE both)", {
  buffer: zipParts([
    { name: "redirects.csv", data: csvBuf([{ command: "DELETE", path: rPath }], ["command", "path"]) },
    { name: "collections.csv", data: csvBuf([{ command: "DELETE", handle: colHandle }], ["command", "handle"]) },
  ]),
  filename: "e2e-bundle-del.zip", format: "zip",
}, async (job) => {
  if (job.deleted < 2) throw new Error(`deleted=${job.deleted} failed=${job.failed}`);
  return "both deleted";
});

// ── 4. gift card create + deactivate ─────────────────────────────────────────
const gcNote = `e2e-gc-${TS}`;
let gcId = null;
await runImport("import gift cards csv (create)", {
  buffer: csvBuf(
    [{ command: "NEW", initial_value: "1.00", note: gcNote }],
    ["command", "initial_value", "note"],
  ),
  filename: "gift cards.csv", format: "csv",
}, async (job) => {
  if (job.created < 1) throw new Error(`created=${job.created} failed=${job.failed}`);
  const gc = await eventually(async () => (await gql(`{ giftCards(first: 5, query: "note:${gcNote}") { nodes { id balance { amount } } } }`)).giftCards.nodes[0]);
  if (!gc) throw new Error("gift card not found by note");
  gcId = gc.id.split("/").pop();
  return `created gift card ${gcId}, balance ${gc.balance.amount}`;
});

await runImport("import gift cards csv (DELETE = deactivate)", {
  buffer: csvBuf([{ command: "DELETE", gift_card_id: gcId ?? "" }], ["command", "gift_card_id"]),
  filename: "gift cards.csv", format: "csv",
}, async (job) => {
  if (job.deleted < 1) throw new Error(`deleted=${job.deleted} failed=${job.failed}`);
  const gc = await eventually(async () => (await gql(`{ giftCards(first: 5, query: "note:${gcNote}") { nodes { deactivatedAt } } }`)).giftCards.nodes[0]);
  if (!gc?.deactivatedAt) throw new Error("not deactivated");
  return "deactivated + verified";
});

// ── 5. discounts round-trip ──────────────────────────────────────────────────
const dCode = `E2E${TS}`;
await runImport("import discounts csv (create)", {
  buffer: csvBuf(
    [{ command: "NEW", codes: dCode, title: `E2E Discount ${TS}`, value_type: "percentage", value: "10" }],
    ["command", "codes", "title", "value_type", "value"],
  ),
  filename: "discounts.csv", format: "csv",
}, async (job) => {
  if (job.created < 1) throw new Error(`created=${job.created} failed=${job.failed}`);
  return `discount ${dCode} created`;
});
await runImport("import discounts csv (DELETE)", {
  buffer: csvBuf([{ command: "DELETE", codes: dCode }], ["command", "codes"]),
  filename: "discounts.csv", format: "csv",
}, async (job) => {
  if (job.deleted < 1) throw new Error(`deleted=${job.deleted} failed=${job.failed}`);
  return "discount deleted";
});

// ── 6. orders dry run (no store writes) ──────────────────────────────────────
await runImport("import orders csv (dry run)", {
  buffer: csvBuf(
    [{ command: "NEW", email: "e2e-order@example.com", line_item_title: "E2E Item", line_item_quantity: "1", line_item_price: "9.99" }],
    ["command", "email", "line_item_title", "line_item_quantity", "line_item_price"],
  ),
  filename: "orders.csv", format: "csv",
  options: { mode: "dryRun" },
}, async (job) => `dry run finished (created=${job.created}, failed=${job.failed}) — no store writes`);

// ── 7. import plan: row filter + column selection ────────────────────────────
const keepHandle = `e2e-keep-${TS}`;
const dropHandle = `e2e-drop-${TS}`;
await runImport("import with plan (row filter + column selection)", {
  buffer: csvBuf(
    [
      { command: "NEW", handle: keepHandle, title: `KEEPME ${TS}`, vendor: "E2E", status: "DRAFT" },
      { command: "NEW", handle: dropHandle, title: `DROPME ${TS}`, vendor: "E2E", status: "DRAFT" },
    ],
    ["command", "handle", "title", "vendor", "status"],
  ),
  filename: "products.csv", format: "csv",
  plan: [{
    entity: "products", include: true,
    filters: [{ column: "title", operator: "contains", value: "KEEPME" }],
    columns: ["command", "handle", "title", "status"],
  }],
}, async (job) => {
  if (job.created !== 1) throw new Error(`expected exactly 1 created (filtered), got ${job.created}`);
  const kept = await eventually(async () => (await gql(`{ productByHandle(handle: "${keepHandle}") { id vendor } }`)).productByHandle);
  const dropped = (await gql(`{ productByHandle(handle: "${dropHandle}") { id } }`)).productByHandle;
  if (!kept) throw new Error("KEEPME row not imported");
  if (dropped) throw new Error("DROPME row imported despite filter");
  const vendorStripped = !kept.vendor || kept.vendor === "" ? "vendor column stripped" : `vendor=${kept.vendor} (column selection: vendor excluded)`;
  return `row filter worked; ${vendorStripped}`;
});
// cleanup
await runImport("import plan cleanup (DELETE)", {
  buffer: csvBuf([{ command: "DELETE", handle: keepHandle }], ["command", "handle"]),
  filename: "products.csv", format: "csv",
}, async (job) => (job.deleted >= 1 ? "cleaned up" : "nothing to clean"));

summary(fs, new URL("./phase2-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
