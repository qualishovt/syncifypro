/**
 * utils/timezones.js
 *
 * IANA timezone choices for the Settings and Scheduler pickers. Uses the
 * runtime's full list when available (every store's `ianaTimezone` is then
 * selectable), falling back to a curated set on older engines. The current
 * value is always included so an existing selection never disappears.
 */

const CURATED = [
  "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
  "Asia/Dubai", "Asia/Baku", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo",
  "Australia/Sydney", "Pacific/Auckland",
];

let cached = null;
function allZones() {
  if (cached) return cached;
  let zones = CURATED;
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const full = Intl.supportedValuesOf("timeZone");
      if (full.length) zones = ["UTC", ...full.filter((z) => z !== "UTC")];
    }
  } catch {
    // keep curated
  }
  cached = zones;
  return zones;
}

/** Zone names for a picker, with `current` guaranteed present (in place, sorted). */
export function timezoneChoices(current) {
  const zones = allZones();
  if (!current || zones.includes(current)) return zones;
  return ["UTC", ...[...zones.slice(1), current].sort()];
}

/** "America/New_York" → "America/New York" */
export const timezoneLabel = (z) => String(z).replace(/_/g, " ");
