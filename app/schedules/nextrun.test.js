/**
 * schedules/nextrun.test.js
 *
 * Timezone-aware next-run maths: hour/minute/weekday/monthday are the
 * merchant's wall clock in the schedule's IANA timezone; the result is the
 * matching UTC instant. (Zone-less cadence cases live in cadence.test.js.)
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computeNextRun, isValidTimezone, zonedDateTimeToUtc } from "./nextrun.js";

const at = (iso) => new Date(iso);
const next = (sch, from) => computeNextRun(sch, at(from)).toISOString();

test("daily at 08:00 runs at 08:00 in the schedule's zone, not the server's", () => {
  // Baku is UTC+4 all year → 08:00 local = 04:00 UTC.
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0, timezone: "Asia/Baku" }, "2026-09-03T10:00:00Z"),
    "2026-09-04T04:00:00.000Z",
  );
  // Still today when the local time hasn't passed: 10:00Z = 14:00 Baku; 18:00 Baku = 14:00Z.
  assert.equal(
    next({ frequency: "daily", hour: 18, minute: 0, timezone: "Asia/Baku" }, "2026-09-03T10:00:00Z"),
    "2026-09-03T14:00:00.000Z",
  );
  // New York in summer is UTC-4 → 08:00 local = 12:00 UTC.
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0, timezone: "America/New_York" }, "2026-09-03T10:00:00Z"),
    "2026-09-03T12:00:00.000Z",
  );
});

test("unknown or missing timezone falls back to UTC", () => {
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0, timezone: "Mars/Olympus" }, "2026-09-03T10:00:00Z"),
    "2026-09-04T08:00:00.000Z",
  );
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0 }, "2026-09-03T10:00:00Z"),
    "2026-09-04T08:00:00.000Z",
  );
  assert.equal(isValidTimezone("Europe/London"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Mars/Olympus"), false);
  assert.equal(isValidTimezone(""), false);
});

test("DST: London spring-forward and New York fall-back, both sides", () => {
  // 2026-03-29 01:00 UTC London jumps to BST → 08:00 London on the 29th = 07:00 UTC.
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0, timezone: "Europe/London" }, "2026-03-28T10:00:00Z"),
    "2026-03-29T07:00:00.000Z",
  );
  // The day before is still GMT: 08:00 London = 08:00 UTC.
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0, timezone: "Europe/London" }, "2026-03-27T10:00:00Z"),
    "2026-03-28T08:00:00.000Z",
  );
  // 2026-11-01 New York leaves EDT: 08:00 local = 13:00 UTC (12:00 the day before).
  assert.equal(
    next({ frequency: "daily", hour: 8, minute: 0, timezone: "America/New_York" }, "2026-10-31T13:00:00Z"),
    "2026-11-01T13:00:00.000Z",
  );
});

test("weekly/monthly/hourly/sub-hourly use the zone's calendar and clock", () => {
  // Monday 09:00 Tokyo (UTC+9) = Monday 00:00 UTC; from Sun 20:00Z (= Mon 05:00 Tokyo).
  assert.equal(
    next({ frequency: "weekly", weekday: 1, hour: 9, minute: 0, timezone: "Asia/Tokyo" }, "2026-09-06T20:00:00Z"),
    "2026-09-07T00:00:00.000Z",
  );
  // Monthly on the 1st at 00:30 Sydney (AEST, UTC+10) = 14:30 UTC the day before.
  assert.equal(
    next({ frequency: "monthly", monthday: 1, hour: 0, minute: 30, timezone: "Australia/Sydney" }, "2026-09-03T10:00:00Z"),
    "2026-09-30T14:30:00.000Z",
  );
  // Hourly at :30 in Kolkata (UTC+5:30): 10:07Z = 15:37 IST → 16:30 IST = 11:00Z.
  assert.equal(
    next({ frequency: "hourly", minute: 30, timezone: "Asia/Kolkata" }, "2026-09-03T10:07:00Z"),
    "2026-09-03T11:00:00.000Z",
  );
  // 15-minute grid on the local clock: 15:37 IST → 15:45 IST = 10:15Z.
  assert.equal(
    next({ frequency: "every15min", timezone: "Asia/Kolkata" }, "2026-09-03T10:07:00Z"),
    "2026-09-03T10:15:00.000Z",
  );
});

test("startAt and interval cadences are absolute instants (no zone shift)", () => {
  assert.equal(
    next({ frequency: "daily", hour: 8, timezone: "Asia/Baku", startAt: "2026-09-10T05:00:00Z" }, "2026-09-03T10:00:00Z"),
    "2026-09-10T05:00:00.000Z",
  );
  assert.equal(
    next({ frequency: "daily", timezone: "Asia/Baku", intervalUnit: "hours", intervalCount: 6 }, "2026-09-03T10:00:00Z"),
    "2026-09-03T16:00:00.000Z",
  );
  // zonedDateTimeToUtc: 18:33 Baku on 2026-09-03 = 14:33 UTC.
  assert.equal(zonedDateTimeToUtc("2026-09-03", 18, 33, "Asia/Baku").toISOString(), "2026-09-03T14:33:00.000Z");
  assert.equal(zonedDateTimeToUtc("bad", 1, 0, "UTC"), null);
});
