/**
 * db/importPreset.server.js
 *
 * Saved import configurations (per-sheet plan + import mode). The write-side
 * twin of exportPreset.server.js: persisted per shop so a plan survives reloads,
 * can be re-applied on the Import page, and can be referenced by a Schedule to
 * re-import a file with the same filters/columns/mode.
 */

import db from "../db.server.js";

/** All of a shop's import presets, newest first. */
export async function listImportPresets(shop) {
  return db.importPreset.findMany({ where: { shop }, orderBy: { updatedAt: "desc" } });
}

export async function getImportPreset(shop, id) {
  return db.importPreset.findFirst({ where: { id, shop } });
}

/** Create or overwrite a named preset. `plan`/`options` are objects (stored as JSON). */
export async function saveImportPreset({ shop, name, format, plan, options }) {
  const data = {
    format: format || "csv",
    plan: JSON.stringify(plan ?? []),
    options: options == null ? null : JSON.stringify(options),
  };
  return db.importPreset.upsert({
    where: { shop_name: { shop, name } },
    update: data,
    create: { shop, name, ...data },
  });
}

export async function deleteImportPreset(shop, id) {
  await db.importPreset.deleteMany({ where: { id, shop } });
}
