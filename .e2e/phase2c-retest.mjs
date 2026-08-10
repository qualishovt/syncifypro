// Phase 2c — retest after fixes: collections DELETE honored (by handle),
// discounts create/DELETE with defaulted startsAt. Cleans all e2e leftovers.
import fs from "node:fs";
import { queueImport, waitJob, gql, record, summary, results } from "./lib.mjs";

const { toCSV } = await import("../app/export/formats/csv.js");
const csvBuf = (rows, cols) => toCSV(rows, cols);
const TS = Date.now();

async function runImport(name, args, verify) {
  try {
    const id = await queueImport(args);
    const job = await waitJob("import", id);
    if (job.status !== "complete") return record(name, false, job.errorMessage || job.status);
    const detail = await verify?.(job);
    record(name, true, detail ?? `c${job.created} u${job.updated} d${job.deleted} f${job.failed}`);
    return job;
  } catch (e) {
    record(name, false, e.message.slice(0, 200));
  }
}

// collections: create then DELETE BY HANDLE (the exact case that failed)
const colHandle = `e2e-c2-${TS}`;
await runImport("collections create", {
  buffer: csvBuf([{ command: "NEW", handle: colHandle, title: `E2E C2 ${TS}` }], ["command", "handle", "title"]),
  filename: "collections.csv", format: "csv",
}, async (j) => (j.created === 1 ? "created" : Promise.reject(new Error(`c${j.created} f${j.failed}`))));

await runImport("collections DELETE by handle (command now mapped)", {
  buffer: csvBuf([{ command: "DELETE", handle: colHandle }], ["command", "handle"]),
  filename: "collections.csv", format: "csv",
}, async (j) => {
  if (j.deleted !== 1) throw new Error(`deleted=${j.deleted} updated=${j.updated} failed=${j.failed}`);
  const gone = (await gql(`{ collectionByHandle(handle: "${colHandle}") { id } }`)).collectionByHandle;
  if (gone) throw new Error("collection still exists");
  return "deleted + verified gone";
});

// leftover collection from phase 2/2b — delete via the app too
const leftovers = (await gql(`{ collections(first: 100, query: "title:E2E*") { nodes { id handle } } }`)).collections.nodes
  .filter((c) => c.handle.startsWith("e2e-"));
if (leftovers.length) {
  await runImport("cleanup leftover e2e collections", {
    buffer: csvBuf(leftovers.map((c) => ({ command: "DELETE", handle: c.handle })), ["command", "handle"]),
    filename: "collections.csv", format: "csv",
  }, async (j) => `deleted ${j.deleted}/${leftovers.length}`);
}

// discounts: create (startsAt defaulted) then DELETE
const dCode = `E2EC${TS}`;
await runImport("discounts create (startsAt defaulted)", {
  buffer: csvBuf(
    [{ command: "NEW", codes: dCode, title: `E2E Discount C`, value_type: "percentage", value: "10" }],
    ["command", "codes", "title", "value_type", "value"],
  ),
  filename: "discounts.csv", format: "csv",
}, async (j) => {
  if (j.created !== 1) throw new Error(`created=${j.created} failed=${j.failed}`);
  const node = (await gql(`{ codeDiscountNodeByCode(code: "${dCode}") { id } }`)).codeDiscountNodeByCode;
  if (!node) throw new Error("discount not found in store");
  return "created + verified";
});
await runImport("discounts DELETE", {
  buffer: csvBuf([{ command: "DELETE", codes: dCode }], ["command", "codes"]),
  filename: "discounts.csv", format: "csv",
}, async (j) => {
  if (j.deleted !== 1) throw new Error(`deleted=${j.deleted} failed=${j.failed}`);
  return "deleted";
});

summary(fs, new URL("./phase2c-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
