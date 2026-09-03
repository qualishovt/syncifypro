/**
 * schedules/nextrun.js
 *
 * Next-run maths for schedules, timezone-aware and dependency-free (Intl only).
 *
 * A schedule's hour / minute / weekday / monthday are the merchant's wall clock
 * in the schedule's IANA `timezone`, while the scheduler compares UTC instants,
 * so the calculation converts both ways: "now" → wall clock in the zone, do the
 * cadence arithmetic there with plain getUTC / setUTC calls on a pseudo-UTC
 * Date, then convert the result back to a real UTC instant. Unknown or missing
 * zones fall back to UTC. Kept free of server imports so it can be unit-tested
 * directly and reused on the client.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** True if this runtime knows the zone (e.g. "Europe/London"; "UTC" is fine). */
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

// Wall-clock fields of `date` in `tz`, packed into a "pseudo-UTC" Date so the
// frequency arithmetic below can use plain getUTC* / setUTC* calls.
function toWall(date, tz) {
  const p = {};
  for (const { type, value } of dtf(tz).formatToParts(date)) p[type] = value;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

// Inverse of toWall: the UTC instant at which `tz` shows this wall clock. Two
// passes cover DST — the offset at the first guess can differ from the offset
// at the answer.
function fromWall(wall, tz) {
  let guess = wall.getTime();
  for (let i = 0; i < 2; i++) {
    const offset = toWall(new Date(guess), tz).getTime() - guess;
    guess = wall.getTime() - offset;
  }
  return new Date(guess);
}

/**
 * Interpret Y-M-D + H:M as wall-clock time in `tz` → absolute UTC Date
 * (used for the "Schedule on" deferred first run).
 */
export function zonedDateTimeToUtc(dateStr, hour, minute, tz) {
  const [y, m, d] = String(dateStr).split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  const wall = new Date(Date.UTC(y, m - 1, d, clampInt(hour, 0, 23, 0), clampInt(minute, 0, 59, 0), 0));
  return fromWall(wall, isValidTimezone(tz) ? tz : "UTC");
}

/**
 * Next run Date (UTC) at/after `from` for a schedule's cadence. Time-of-day
 * fields are read in the schedule's timezone, so "08:00 daily" means 08:00
 * where the merchant is.
 * @param {{frequency:string,hour?:number,minute?:number,weekday?:number,monthday?:number,timezone?:string,startAt?:Date|string|null,intervalCount?:number|null,intervalUnit?:string|null}} sch
 */
export function computeNextRun(sch, from = new Date()) {
  // Deferred first run ("Schedule on"): until startAt passes, that IS the
  // next run — regardless of any cadence.
  if (sch.startAt && new Date(sch.startAt) > from) return new Date(sch.startAt);

  // Interval cadence ("Repeat every N units") overrides the fixed
  // frequencies. Elapsed time is absolute, so no timezone is involved.
  // Months/years are calendar-approximated (30/365 days).
  if (sch.intervalUnit && sch.intervalCount > 0) {
    const MS = {
      minutes: 60_000, hours: 3_600_000, days: 86_400_000,
      weeks: 604_800_000, months: 2_592_000_000, years: 31_536_000_000,
    };
    const ms = MS[sch.intervalUnit];
    if (ms) return new Date(from.getTime() + sch.intervalCount * ms);
  }

  const tz = isValidTimezone(sch.timezone) ? sch.timezone : "UTC";
  const now = toWall(from, tz);
  const done = (wall) => fromWall(wall, tz);

  const hour = clampInt(sch.hour, 0, 23, 3);
  const minute = clampInt(sch.minute, 0, 59, 0);

  // Sub-hourly: the next slot on a fixed N-minute grid (:00/:15/:30/:45).
  // setUTCMinutes handles the rollover into the next hour/day.
  if (sch.frequency === "every15min" || sch.frequency === "every30min") {
    const step = sch.frequency === "every15min" ? 15 : 30;
    const next = new Date(now);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(Math.floor(next.getUTCMinutes() / step) * step + step);
    return done(next);
  }

  if (sch.frequency === "hourly") {
    const next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), minute, 0, 0,
    ));
    if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
    return done(next);
  }

  if (sch.frequency === "weekly") {
    const wd = clampInt(sch.weekday, 0, 6, 1);
    let next = atTime(now, hour, minute);
    for (let i = 0; i < 8; i++) {
      if (next.getUTCDay() === wd && next > now) return done(next);
      next = atTime(new Date(next.getTime() + DAY_MS), hour, minute);
    }
    return done(next);
  }

  if (sch.frequency === "monthly") {
    const md = clampInt(sch.monthday, 1, 31, 1);
    let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), md, hour, minute, 0, 0));
    if (next <= now) next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, md, hour, minute, 0, 0));
    return done(next);
  }

  if (sch.frequency === "quarterly") {
    const md = clampInt(sch.monthday, 1, 31, 1);
    let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), md, hour, minute, 0, 0));
    while (next <= now) {
      next = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 3, md, hour, minute, 0, 0));
    }
    return done(next);
  }

  // daily (default)
  let next = atTime(now, hour, minute);
  if (next <= now) next = new Date(next.getTime() + DAY_MS);
  return done(next);
}

const atTime = (d, h, m) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0, 0));
const clampInt = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
};
