// Phase 2b — investigate discounts failure (read the results workbook
// comments), and retest DELETE-by-id for redirects/collections (also cleans
// up phase 2's leftovers).
import fs from "node:fs";
import { queueImport, waitJob, gql, downloadR2, record, summary, results } from "./lib.mjs";

const { toCSV } = await import("../app/export/formats/csv.js");
const { parseXLSX } = await import("../app/import/parsers/xlsx.js");
const { zipParts } = await import("../app/export/formats/zip.js");
const csvBuf = (rows, cols) => toCSV(rows, cols);

// ── discounts: rerun create and surface the per-row comment ─────────────────
const dCode = `E2EB${Date.now()}`;
{
  const id = await queueImport({
    buffer: csvBuf(
      [{ command: "NEW", codes: dCode, title: `E2E Discount B`, value_type: "percentage", value: "10" }],
      ["command", "codes", "title", "value_type", "value"],
    ),
    filename: "discounts.csv", format: "csv",
  });
  const job = await waitJob("import", id);
  let comment = "(no results workbook)";
  if (job.resultR2Key) {
    const wb = parseXLSX(await downloadR2(job.resultR2Key));
    const rows = wb.flatMap((s) => s.rows);
    comment = rows.map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" | ")).join("\n");
  }
  console.log("discounts create diagnostic:\n" + comment);
  record("discounts diagnostic run", true, `created=${job.created} failed=${job.failed}`);
}

// ── redirects/collections DELETE by ID (and cleanup of phase-2 leftovers) ───
const redirects = (await gql(`{ urlRedirects(first: 100) { nodes { id path } } }`)).urlRedirects.nodes
  .filter((r) => r.path.startsWith("/e2e-old-"));
const collections = (await gql(`{ collections(first: 100, query: "title:E2E*") { nodes { id handle title } } }`)).collections.nodes
  .filter((c) => c.handle.startsWith("e2e-collection-"));
console.log(`leftovers: ${redirects.length} redirect(s), ${collections.length} collection(s)`);

if (redirects.length || collections.length) {
  const id = await queueImport({
    buffer: zipParts([
      { name: "redirects.csv", data: csvBuf(
        redirects.map((r) => ({ command: "DELETE", redirect_id: r.id.split("/").pop(), path: r.path })),
        ["command", "redirect_id", "path"],
      ) },
      { name: "collections.csv", data: csvBuf(
        collections.map((c) => ({ command: "DELETE", collection_id: c.id.split("/").pop(), handle: c.handle })),
        ["command", "collection_id", "handle"],
      ) },
    ]),
    filename: "e2e-delete-by-id.zip", format: "zip",
  });
  const job = await waitJob("import", id);
  const want = redirects.length + collections.length;
  record("zip DELETE by id (redirect + collection)", job.deleted >= want, `deleted ${job.deleted}/${want}, failed ${job.failed}`);
  const after = (await gql(`{ urlRedirects(first: 100) { nodes { path } } }`)).urlRedirects.nodes
    .filter((r) => r.path.startsWith("/e2e-old-"));
  record("leftovers cleaned", after.length === 0, `${after.length} e2e redirects remain`);
} else {
  record("zip DELETE by id", false, "no leftovers found to delete (unexpected)");
}

summary(fs, new URL("./phase2b-results.json", import.meta.url));
