/**
 * import/headers.js
 *
 * The inverse of the export header layer. Export writes humanized headers
 * ("ID", "Variant SKU", "Body HTML") via columnHeader() while keeping row
 * values keyed by the raw snake_case key. Import has to reverse that: turn
 * the humanized header row back into snake_case keys so validators and
 * writers can read `row.product_id`, `row.sku`, etc. — the exact keys the
 * export normalizer produced.
 *
 * The map is PER-ENTITY on purpose: FIELD_LABELS is a global map with labels
 * that collide across entities (product_id, order_id, collection_id all →
 * "ID"). Building the reverse map from a single entity's FIELDS_BY_ENTITY
 * list keeps it unambiguous. (We verify at load time that a given entity's
 * labels are collision-free; a collision would silently drop a column.)
 *
 * Dynamic columns — Metafields ("Metafield: custom.x [type]"), per-location
 * Inventory ("Inventory Available: Main"), Pricing by Catalogs ("Price /
 * Wholesale") — are NOT in FIELDS_BY_ENTITY: their key already IS the header,
 * so they pass through unchanged. Any unrecognized header also passes through
 * verbatim, so custom/unknown columns survive a round-trip rather than being
 * dropped.
 */

import { FIELDS_BY_ENTITY } from "../export/fieldLists.js";
import { columnHeader } from "../export/formats/columns.js";

const _cache = new Map();

/**
 * Build (and cache) the reverse header map for an entity: humanized header
 * → snake_case key. Throws if two keys in the entity share a label, since
 * that would make the reverse ambiguous and silently lose data.
 *
 * @param {string} entity
 * @returns {Map<string, string>} header → key
 */
export function reverseHeaderMap(entity) {
  if (_cache.has(entity)) return _cache.get(entity);

  const keys = FIELDS_BY_ENTITY[entity];
  if (!keys) throw new Error(`Unknown entity for header mapping: ${entity}`);

  const map = new Map();
  for (const key of keys) {
    const header = columnHeader(key);
    if (map.has(header)) {
      throw new Error(
        `Header collision in "${entity}": "${header}" maps to both ` +
          `${map.get(header)} and ${key}. Give one a distinct FIELD_LABELS entry.`,
      );
    }
    map.set(header, key);
  }

  _cache.set(entity, map);
  return map;
}

/**
 * Dynamic columns aren't in FIELDS_BY_ENTITY (their key IS the header) but are
 * still valid — so they must not be flagged as "unknown" in the UI. Match the
 * families the export emits: metafields, per-location inventory, and pricing by
 * catalog ("Price / Wholesale").
 */
const DYNAMIC_COLUMN_PATTERNS = [
  /metafield/i,
  /^inventory\b/i,
  /\bprice\s*\//i,
  /^compare at price\s*\//i,
];

function isDynamicColumn(header) {
  return DYNAMIC_COLUMN_PATTERNS.some((re) => re.test(header));
}

/**
 * Classify a file's headers against an entity as recognized or unknown — powers
 * the per-sheet column list in the import preview (unknown columns get an
 * orange flag, Matrixify-style, and are imported as pass-through custom data).
 *
 * @param {string} entity
 * @param {string[]} headers - raw humanized headers from the file
 * @returns {{ columns: {name: string, known: boolean}[], unknown: string[] }}
 */
export function classifyColumns(entity, headers) {
  let map;
  try {
    map = reverseHeaderMap(entity);
  } catch {
    map = new Map();
  }
  const columns = headers.map((name) => ({
    name,
    known: map.has(name) || isDynamicColumn(name),
  }));
  return { columns, unknown: columns.filter((c) => !c.known).map((c) => c.name) };
}

/**
 * Re-key a single parsed row from humanized headers to snake_case keys.
 * Unknown headers (dynamic columns, custom columns) are kept as-is.
 *
 * @param {object} row - parsed row keyed by file header
 * @param {Map<string,string>} map - from reverseHeaderMap(entity)
 * @returns {object} row keyed by snake_case key
 */
export function normalizeRowHeaders(row, map) {
  const out = {};
  for (const [header, value] of Object.entries(row)) {
    out[map.get(header) ?? header] = value;
  }
  return out;
}

/**
 * Re-key every parsed row for an entity. This is the first step after
 * parsing, before validation/assembly — everything downstream works in
 * snake_case, matching the export normalizer's output.
 *
 * @param {object[]} rows
 * @param {string} entity
 * @returns {object[]}
 */
export function normalizeHeaders(rows, entity) {
  const map = reverseHeaderMap(entity);
  return rows.map((row) => normalizeRowHeaders(row, map));
}
