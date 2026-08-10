// Phase 3 — post-campaign freshness smoke: one export cell, one import
// round-trip, and a store-cleanliness check for e2e leftovers.
import fs from "node:fs";
import { queueExport, queueImport, waitJob, gql, downloadR2, record, summary, results } from "./lib.mjs";

const { toCSV } = await import("../app/export/formats/csv.js");
const TS = Date.now();

// 1. export products csv
{
  const id = await queueExport({ specs: [{ entity: "products", filters: {}, fields: null }], format: "csv" });
  const job = await waitJob("export", id);
  const buffer = job.r2Key ? await downloadR2(job.r2Key) : null;
  const rows = buffer ? buffer.toString("utf8").trim().split("\n").length - 1 : 0;
  record("smoke: export products csv", job.status === "complete" && rows > 0, `${rows} data rows`);
}

// 2. import round-trip
const handle = `e2e-smoke-${TS}`;
{
  const id = await queueImport({
    buffer: toCSV([{ command: "NEW", handle, title: `E2E Smoke ${TS}`, vendor: "E2E", status: "DRAFT" }], ["command", "handle", "title", "vendor", "status"]),
    filename: "products.csv", format: "csv",
  });
  const job = await waitJob("import", id);
  const found = (await gql(`{ productByHandle(handle: "${handle}") { id } }`)).productByHandle;
  record("smoke: import product (create)", job.status === "complete" && job.created === 1 && Boolean(found), `created=${job.created}`);
}
{
  const id = await queueImport({
    buffer: toCSV([{ command: "DELETE", handle }], ["command", "handle"]),
    filename: "products.csv", format: "csv",
  });
  const job = await waitJob("import", id);
  const gone = !(await gql(`{ productByHandle(handle: "${handle}") { id } }`)).productByHandle;
  record("smoke: import product (DELETE)", job.status === "complete" && job.deleted === 1 && gone, "verified gone");
}

// 3. store cleanliness — no e2e test data left anywhere
{
  const prods = (await gql(`{ products(first: 50, query: "handle:e2e-*") { nodes { handle } } }`)).products.nodes;
  const cols = (await gql(`{ collections(first: 50, query: "title:E2E*") { nodes { handle } } }`)).collections.nodes.filter((c) => c.handle.startsWith("e2e-"));
  const custs = (await gql(`{ customers(first: 50, query: "email:e2e-*") { nodes { email } } }`)).customers.nodes;
  const reds = (await gql(`{ urlRedirects(first: 100) { nodes { path } } }`)).urlRedirects.nodes.filter((r) => r.path.startsWith("/e2e-"));
  const clean = !prods.length && !cols.length && !custs.length && !reds.length;
  record("store cleanliness (no e2e leftovers)", clean,
    clean ? "clean" : `products=${prods.length} collections=${cols.length} customers=${custs.length} redirects=${reds.length}`);
}

summary(fs, new URL("./phase3-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
