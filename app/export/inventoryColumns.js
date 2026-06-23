/**
 * export/inventoryColumns.js
 *
 * Multi-Location Inventory Levels — the one product group whose columns are
 * dynamic: every store location produces its own set of inventory columns.
 *
 * The column KEY is the human header itself ("Inventory Available: Main"),
 * so it doubles as the export header (columnHeader() falls back to the key)
 * and round-trips the same way Matrixify's per-location columns do. The UI
 * (which builds the selector group) and the normalizer (which fills the row)
 * both derive their keys from here, so they always line up.
 */

/**
 * Inventory states in Matrixify's column order. `adjust: true` adds a paired
 * "<label> Adjust: <location>" import-control column (blank on export, used
 * on import to apply a relative change).
 */
export const INVENTORY_STATES = [
  { name: "available",       label: "Inventory Available",       adjust: true },
  { name: "on_hand",         label: "Inventory On Hand",         adjust: true },
  { name: "committed",       label: "Inventory Committed",       adjust: false },
  { name: "reserved",        label: "Inventory Reserved",        adjust: false },
  { name: "damaged",         label: "Inventory Damaged",         adjust: true },
  { name: "safety_stock",    label: "Inventory Safety Stock",    adjust: true },
  { name: "quality_control", label: "Inventory Quality Control", adjust: true },
  { name: "incoming",        label: "Inventory Incoming",        adjust: false },
];

/** The InventoryLevel.quantities(names:) argument — the real states only. */
export const INVENTORY_QUANTITY_NAMES = INVENTORY_STATES.map((s) => s.name);

const LABEL_BY_NAME = Object.fromEntries(INVENTORY_STATES.map((s) => [s.name, s.label]));

/** "Inventory Available" + "Main Warehouse" → "Inventory Available: Main Warehouse" */
export function inventoryColumnKey(label, locationName) {
  return `${label}: ${locationName}`;
}

/**
 * Build the ordered Multi-Location Inventory field keys for a set of
 * locations — used to populate the UI group and the entity's column list.
 *
 * @param {{name: string}[]} locations
 * @returns {string[]}
 */
export function buildInventoryFieldKeys(locations = []) {
  const keys = [];
  for (const loc of locations) {
    for (const s of INVENTORY_STATES) {
      keys.push(inventoryColumnKey(s.label, loc.name));
      if (s.adjust) keys.push(inventoryColumnKey(`${s.label} Adjust`, loc.name));
    }
  }
  return keys;
}

/**
 * Flatten a variant's inventoryLevels into { columnKey: quantity } entries
 * to merge into the normalized row. "Adjust" columns are import-control, so
 * they're never emitted (they stay blank in the file).
 *
 * @param {object[]} [levels] - variant.inventoryItem.inventoryLevels.nodes
 * @returns {Object<string, number>}
 */
export function inventoryRowEntries(levels) {
  const out = {};
  for (const level of levels ?? []) {
    const locName = level?.location?.name;
    if (!locName) continue;
    for (const q of level.quantities ?? []) {
      const label = LABEL_BY_NAME[q.name];
      if (!label) continue;
      out[inventoryColumnKey(label, locName)] = q.quantity ?? "";
    }
  }
  return out;
}
