/**
 * db/exportPreset.server.js
 *
 * Saved export configurations (entities + filters + column selection). Persisted
 * per shop so they survive reloads and can be referenced by a Schedule to run a
 * filtered export automatically.
 */

import db from "../db.server.js";

/** All of a shop's presets, newest first. */
export async function listPresets(shop) {
  return db.exportPreset.findMany({ where: { shop }, orderBy: { updatedAt: "desc" } });
}

export async function getPreset(shop, id) {
  return db.exportPreset.findFirst({ where: { id, shop } });
}

/** Create or overwrite a named preset. `spec`/`state` are objects (stored as JSON). */
export async function savePreset({ shop, name, format, spec, state, splitRows, options }) {
  const data = {
    format: format || "csv",
    spec: JSON.stringify(spec ?? []),
    state: state == null ? null : JSON.stringify(state),
    splitRows: Number.isInteger(splitRows) && splitRows > 0 ? splitRows : null,
    options: options == null ? null : JSON.stringify(options),
  };
  return db.exportPreset.upsert({
    where: { shop_name: { shop, name } },
    update: data,
    create: { shop, name, ...data },
  });
}

export async function deletePreset(shop, id) {
  await db.exportPreset.deleteMany({ where: { id, shop } });
}
