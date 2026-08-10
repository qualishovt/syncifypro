import fs from "node:fs";
import { queueExport, waitJob, record, summary, results } from "./lib.mjs";

const id = await queueExport({
  specs: [{ entity: "products", filters: {}, fields: null, advancedFilters: [{ column: "title", operator: "contains_any", value: "jseh" }] }],
  format: "csv",
});
const job = await waitJob("export", id);
record(
  "advanced filter (title contains_any jseh)",
  job.status === "complete" && job.rowCount < 117 && job.rowCount > 0,
  `status=${job.status}, rows 117 → ${job.rowCount}`,
);
summary(fs, new URL("./phase1c-results.json", import.meta.url));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
