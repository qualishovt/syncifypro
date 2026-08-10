/**
 * db/appSettings.server.js
 *
 * Per-shop app settings, shown on the Settings page. Covers the file-retention
 * window, default export format / import mode, the display time zone, and email
 * notification preferences. All fields fall back to sensible defaults when no
 * row has been saved yet.
 */

import db from "../db.server.js";

export const DEFAULT_RETENTION_DAYS = 7;

/** Allowed retention choices offered in the UI (0 = never delete). */
export const RETENTION_OPTIONS = [1, 3, 7, 14, 30, 60, 90, 0];

/** Whole-settings defaults for a shop with no saved row. */
export const DEFAULT_SETTINGS = {
  retentionDays: DEFAULT_RETENTION_DAYS,
  defaultExportFormat: "excel",
  defaultImportMode: "normal",
  timezone: "UTC",
  notifyEmail: "",
  notifyOnSuccess: false,
  notifyOnError: false,
  allowExternalDownloads: true,
  blockedEntities: [],
};

/** Read a shop's settings, falling back to defaults when none are saved yet. */
export async function getAppSettings(shop) {
  const row = await db.appSettings.findUnique({ where: { shop } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    retentionDays: row.retentionDays ?? DEFAULT_SETTINGS.retentionDays,
    defaultExportFormat: row.defaultExportFormat ?? DEFAULT_SETTINGS.defaultExportFormat,
    defaultImportMode: row.defaultImportMode ?? DEFAULT_SETTINGS.defaultImportMode,
    timezone: row.timezone ?? DEFAULT_SETTINGS.timezone,
    notifyEmail: row.notifyEmail ?? "",
    notifyOnSuccess: Boolean(row.notifyOnSuccess),
    notifyOnError: Boolean(row.notifyOnError),
    allowExternalDownloads: row.allowExternalDownloads ?? true,
    blockedEntities: parseArray(row.blockedEntities),
  };
}

function parseArray(raw) {
  if (!raw || typeof raw !== "string") return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Set the file-retention window (days; 0 = never delete). */
export async function setRetentionDays(shop, days) {
  const retentionDays = Number.isInteger(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
  await db.appSettings.upsert({
    where: { shop },
    update: { retentionDays },
    create: { shop, retentionDays },
  });
  return retentionDays;
}

// Only these fields can be written through the generic updater.
const WRITABLE = new Set([
  "retentionDays", "defaultExportFormat", "defaultImportMode",
  "timezone", "notifyEmail", "notifyOnSuccess", "notifyOnError",
  "allowExternalDownloads", "blockedEntities",
]);

/**
 * Upsert an arbitrary subset of settings. Unknown keys are ignored; values are
 * coerced to the column's type so a stray string can't corrupt a boolean/int.
 * @param {string} shop
 * @param {object} patch
 * @returns {Promise<object>} the full, current settings
 */
export async function updateAppSettings(shop, patch) {
  const data = {};
  for (const [key, raw] of Object.entries(patch ?? {})) {
    if (!WRITABLE.has(key)) continue;
    if (key === "retentionDays") {
      const n = parseInt(String(raw), 10);
      data.retentionDays = Number.isInteger(n) && n >= 0 ? n : DEFAULT_RETENTION_DAYS;
    } else if (key === "notifyOnSuccess" || key === "notifyOnError" || key === "allowExternalDownloads") {
      data[key] = raw === true || raw === "true" || raw === "on";
    } else if (key === "blockedEntities") {
      const arr = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw); } catch { return []; } })();
      data[key] = JSON.stringify(Array.isArray(arr) ? arr : []);
    } else {
      data[key] = String(raw ?? "").trim();
    }
  }
  await db.appSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
  return getAppSettings(shop);
}
