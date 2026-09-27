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
export async function savePreset({ shop, name, format, spec, state, options }) {
  const data = {
    format: format || "csv",
    spec: JSON.stringify(spec ?? []),
    state: state == null ? null : JSON.stringify(state),
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

/**
 * Names starting with two underscores belong to the page itself (its hidden
 * "last state" style presets), so merchants can't take one.
 */
export const RESERVED_NAME = /^__/;

/** Rename a preset. Returns `{ error }` instead of throwing on a clash. */
export async function renamePreset(shop, id, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return { error: "A preset needs a name." };
  if (RESERVED_NAME.test(clean)) return { error: "A preset name can't start with two underscores." };
  const mine = await db.exportPreset.findFirst({ where: { id, shop } });
  if (!mine) return { error: "That preset is no longer available." };
  if (clean !== mine.name) {
    const taken = await db.exportPreset.findFirst({ where: { shop, name: clean } });
    if (taken) return { error: "Another preset already goes by this name." };
  }
  return { preset: await db.exportPreset.update({ where: { id }, data: { name: clean } }) };
}

/**
 * Copy a preset under the first free "Name (2)", "Name (3)" … so duplicating
 * twice doesn't collide.
 */
export async function duplicatePreset(shop, id) {
  const source = await db.exportPreset.findFirst({ where: { id, shop } });
  if (!source) return { error: "That preset is no longer available." };
  const taken = new Set((await db.exportPreset.findMany({
    where: { shop }, select: { name: true },
  })).map((p) => p.name));
  let name = "";
  for (let n = 2; n < 1000; n++) {
    name = `${source.name} (${n})`;
    if (!taken.has(name)) break;
  }
  return {
    preset: await db.exportPreset.create({
      data: {
        shop, name,
        format: source.format,
        spec: source.spec,
        state: source.state,
        options: source.options,
      },
    }),
  };
}
