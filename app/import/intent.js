/**
 * import/intent.js
 *
 * Matrixify's import preview doesn't just say "1,240 rows" — it says what the
 * file will *do*: "900 new items, 300 updates, 40 deletes". That intent comes
 * from the Command column plus whether each record carries an identifier.
 *
 * This is an ESTIMATE computed without touching Shopify (the analyze step makes
 * no API calls). The true new-vs-update split for a MERGE depends on whether the
 * record already exists in the store, which we can only know at write time — so
 * we infer it from the presence of an ID/handle/email the way Matrixify does.
 *
 * Counting is per RECORD (an assembled group), not per row: a product with five
 * variant rows is one item, one intent.
 */

import { groupRecords, topRow } from "./assemble.js";
import { parseCommand, COMMAND } from "./command.js";

/**
 * Identifier columns per entity. A record "has an identity" (so MERGE means
 * update, not create) when any of these is present and non-blank on its top row.
 */
const IDENTIFIER_KEYS = {
  products:  ["product_id", "handle"],
  orders:    ["order_id", "name"],
  customers: ["customer_id", "email"],
  redirects: ["redirect_id", "path"],
};

function hasIdentity(top, entity) {
  const keys = IDENTIFIER_KEYS[entity] ?? ["id"];
  return keys.some((k) => String(top[k] ?? "").trim() !== "");
}

/**
 * Tally what an import file intends to do, by record.
 *
 * @param {object[]} rows - header-normalized rows (snake_case keys)
 * @param {string} entity
 * @returns {{
 *   records: number,
 *   create: number,
 *   update: number,
 *   delete: number,
 *   skip: number,
 *   unknownCommands: string[],   // distinct invalid Command values seen
 * }}
 */
export function summarizeIntent(rows, entity) {
  const groups = groupRecords(rows);
  const tally = { records: groups.length, create: 0, update: 0, delete: 0, skip: 0 };
  const unknown = new Set();

  for (const group of groups) {
    const top = topRow(group);
    let cmd;
    try {
      cmd = parseCommand(top.command);
    } catch {
      // A typo'd Command is a validation error elsewhere; for the preview we
      // record it and count the record as skipped so totals still add up.
      unknown.add(String(top.command ?? "").trim());
      tally.skip += 1;
      continue;
    }

    switch (cmd) {
      case COMMAND.IGNORE:
        tally.skip += 1;
        break;
      case COMMAND.DELETE:
        tally.delete += 1;
        break;
      case COMMAND.NEW:
        tally.create += 1;
        break;
      case COMMAND.UPDATE:
      case COMMAND.REPLACE:
        // Require an existing record — intent is always update.
        tally.update += 1;
        break;
      case COMMAND.MERGE:
      default:
        tally[hasIdentity(top, entity) ? "update" : "create"] += 1;
        break;
    }
  }

  return { ...tally, unknownCommands: [...unknown] };
}
