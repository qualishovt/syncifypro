/**
 * schedules/cadence.test.js
 *
 * Schedule cadence math (including the sub-hourly grid) and the
 * content-hash change detection that drives "only import new files".
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeNextRun,
  rememberedFiles,
  alreadyImported,
  renderScheduleFilename,
} from "../db/schedule.server.js";

const at = (iso) => new Date(iso);

test("sub-hourly cadences land on the fixed minute grid", () => {
  assert.equal(
    computeNextRun({ frequency: "every15min" }, at("2026-07-27T10:07:00Z")).toISOString(),
    "2026-07-27T10:15:00.000Z",
  );
  assert.equal(
    computeNextRun({ frequency: "every15min" }, at("2026-07-27T10:15:00Z")).toISOString(),
    "2026-07-27T10:30:00.000Z", // exactly on a slot → the NEXT one
  );
  assert.equal(
    computeNextRun({ frequency: "every30min" }, at("2026-07-27T10:07:00Z")).toISOString(),
    "2026-07-27T10:30:00.000Z",
  );
});

test("sub-hourly rolls over the hour and the day", () => {
  assert.equal(
    computeNextRun({ frequency: "every30min" }, at("2026-07-27T10:47:00Z")).toISOString(),
    "2026-07-27T11:00:00.000Z",
  );
  assert.equal(
    computeNextRun({ frequency: "every15min" }, at("2026-07-27T23:52:00Z")).toISOString(),
    "2026-07-28T00:00:00.000Z",
  );
});

test("daily/weekly/monthly/quarterly still work", () => {
  assert.equal(
    computeNextRun({ frequency: "daily", hour: 8, minute: 0 }, at("2026-07-27T10:00:00Z")).toISOString(),
    "2026-07-28T08:00:00.000Z",
  );
  assert.equal(
    computeNextRun({ frequency: "quarterly", hour: 8, minute: 0, monthday: 1 }, at("2026-07-12T10:00:00Z")).toISOString(),
    "2026-10-01T08:00:00.000Z",
  );
});

test("content hash: same name + same content is skipped, changed content re-imports", () => {
  const remembered = rememberedFiles(JSON.stringify([{ n: "feed.csv", h: "aaa" }]));
  assert.equal(alreadyImported(remembered, "feed.csv", "aaa"), true, "unchanged file skipped");
  assert.equal(alreadyImported(remembered, "feed.csv", "bbb"), false, "overwritten file re-imports");
  assert.equal(alreadyImported(remembered, "other.csv", "aaa"), false, "different name imports");
});

test("legacy name-only entries still match (no re-import storm on upgrade)", () => {
  const remembered = rememberedFiles(JSON.stringify(["old.csv"]));
  assert.equal(remembered[0].h, null);
  assert.equal(alreadyImported(remembered, "old.csv", "any-hash"), true);
});

test("filename templates render placeholders and keep a fixed name stable", () => {
  const now = at("2026-07-27T09:30:00Z");
  const sch = { shop: "dataengine.myshopify.com", name: "Nightly Products", entity: "products" };
  assert.equal(renderScheduleFilename(sch, "csv", now), "nightly-products-2026-07-27.csv");
  assert.equal(
    renderScheduleFilename({ ...sch, filename: "{shop}-{name}-{date}" }, "csv", now),
    "dataengine-nightly-products-2026-07-27.csv",
  );
  // A fixed template overwrites the same remote file on every run.
  assert.equal(renderScheduleFilename({ ...sch, filename: "catalog" }, "xlsx", now), "catalog.xlsx");
});
