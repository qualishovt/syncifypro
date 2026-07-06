/**
 * import/writers/productInventory.js
 *
 * Applies the dynamic per-location inventory columns on product import — the
 * inverse of export/inventoryColumns.js. Export emits headers like
 * "Inventory Available: Main" and, for adjustable states, a paired
 * "Inventory Available Adjust: Main". Import reads them back and writes to
 * Shopify:
 *   - absolute `available` / `on_hand`  → inventorySetQuantities (force-set)
 *   - "<state> Adjust" delta columns     → inventoryAdjustQuantities
 * Other states (committed/reserved/…) aren't settable via the API, so their
 * absolute columns are ignored on import — matching what Matrixify can do.
 *
 * The pure parsing (parseInventoryColumn / collectInventory) is unit-tested;
 * applyInventory does the network I/O once the variants' inventoryItem ids
 * are known from the productSet response.
 */

import { INVENTORY_STATES } from "../../export/inventoryColumns.js";

const LABEL_TO_NAME = Object.fromEntries(INVENTORY_STATES.map((s) => [s.label, s.name]));
// Only these states can be set/adjusted through the Admin API.
const SETTABLE = new Set(["available", "on_hand"]);
const ADJUSTABLE = new Set(["available", "damaged", "quality_control", "reserved", "safety_stock"]);

/**
 * Parse an inventory column header into its state + location.
 * "Inventory Available: Main"        → { name: "available", locationName: "Main", isAdjust: false }
 * "Inventory Available Adjust: Main" → { name: "available", locationName: "Main", isAdjust: true }
 * Returns null for non-inventory headers.
 */
export function parseInventoryColumn(header) {
  const sep = header.indexOf(": ");
  if (sep === -1) return null;
  let label = header.slice(0, sep);
  const locationName = header.slice(sep + 2).trim();
  if (!label.startsWith("Inventory ") || !locationName) return null;

  let isAdjust = false;
  if (label.endsWith(" Adjust")) {
    isAdjust = true;
    label = label.slice(0, -" Adjust".length);
  }
  const name = LABEL_TO_NAME[label];
  if (!name) return null;
  return { name, locationName, isAdjust };
}

/**
 * Collect the writable inventory instructions from a single variant row.
 * @returns {{ sets: Array<{name,locationName,quantity}>, adjusts: Array<{name,locationName,delta}> }}
 */
export function collectInventory(row) {
  const sets = [];
  const adjusts = [];
  for (const [header, raw] of Object.entries(row)) {
    const parsed = parseInventoryColumn(header);
    if (!parsed) continue;
    const value = String(raw ?? "").trim();
    if (value === "") continue;
    const n = Number(value);
    if (Number.isNaN(n)) continue;

    if (parsed.isAdjust) {
      if (n !== 0 && ADJUSTABLE.has(parsed.name)) {
        adjusts.push({ name: parsed.name, locationName: parsed.locationName, delta: n });
      }
    } else if (SETTABLE.has(parsed.name)) {
      sets.push({ name: parsed.name, locationName: parsed.locationName, quantity: n });
    }
  }
  return { sets, adjusts };
}

/** Build a case-insensitive location-name → id map from a locations query. */
export function buildLocationMap(nodes = []) {
  const map = new Map();
  for (const n of nodes) if (n?.name) map.set(n.name.trim().toLowerCase(), n.id);
  return map;
}

const SET_QTY = `#graphql
  mutation SetQty($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) { userErrors { field message code } }
  }
`;
const ADJUST_QTY = `#graphql
  mutation AdjustQty($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) { userErrors { field message } }
  }
`;

/**
 * Apply inventory for one variant row given its resolved inventoryItem id.
 * Unknown locations are collected into `warnings` rather than failing the row.
 *
 * @returns {Promise<Array<object>>} userErrors/warnings encountered
 */
export async function applyInventory({ row, inventoryItemId, locationMap, admin }) {
  const { sets, adjusts } = collectInventory(row);
  const problems = [];

  // Group sets by state name (inventorySetQuantities takes one name per call).
  for (const name of SETTABLE) {
    const quantities = sets
      .filter((s) => s.name === name)
      .map((s) => ({ locationId: locationMap.get(s.locationName.toLowerCase()), quantity: s.quantity, locationName: s.locationName }))
      .filter((q) => keepOrWarn(q, problems));
    if (!quantities.length) continue;
    const res = await admin.graphql(SET_QTY, {
      variables: { input: {
        name, reason: "correction", ignoreCompareQuantity: true,
        quantities: quantities.map(({ locationId, quantity }) => ({ inventoryItemId, locationId, quantity })),
      } },
    });
    pushErrors(await res.json(), "inventorySetQuantities", problems);
  }

  for (const name of ADJUSTABLE) {
    const changes = adjusts
      .filter((a) => a.name === name)
      .map((a) => ({ locationId: locationMap.get(a.locationName.toLowerCase()), delta: a.delta, locationName: a.locationName }))
      .filter((c) => keepOrWarn(c, problems));
    if (!changes.length) continue;
    const res = await admin.graphql(ADJUST_QTY, {
      variables: { input: {
        name, reason: "correction",
        changes: changes.map(({ locationId, delta }) => ({ inventoryItemId, locationId, delta })),
      } },
    });
    pushErrors(await res.json(), "inventoryAdjustQuantities", problems);
  }

  return problems;
}

function keepOrWarn(entry, problems) {
  if (entry.locationId) return true;
  problems.push({ field: "inventory", message: `Unknown location "${entry.locationName}"` });
  return false;
}

function pushErrors(json, op, problems) {
  const errs = json?.data?.[op]?.userErrors ?? [];
  for (const e of errs) problems.push(e);
}
