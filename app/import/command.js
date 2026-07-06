/**
 * import/command.js
 *
 * The "Command" column model — the backbone of import. Every record carries
 * a Command that tells the writer what to do with it, mirroring Matrixify's
 * per-row directive. Without this, an importer can only ever blindly upsert;
 * with it, a single file can create, patch, replace, and delete records in
 * one pass, and an exported file re-imports predictably.
 *
 * Semantics (uppercased; blank defaults to MERGE):
 *   MERGE   — update the given fields on an existing record, create it if it
 *             doesn't exist. Fields not present in the row are left untouched.
 *             This is the safe default.
 *   UPDATE  — like MERGE but never creates: skip the row if no match exists.
 *   NEW     — always create a new record, even if a match exists.
 *   REPLACE — full replace: overwrite the record so it matches the row exactly
 *             (fields absent from the row are cleared / child rows not listed
 *             are removed). Writers decide the exact blast radius per entity.
 *   DELETE  — delete the matching record.
 *   IGNORE  — skip the row entirely (handy for round-tripping a file with
 *             rows you don't want re-applied).
 */

export const COMMAND = Object.freeze({
  MERGE: "MERGE",
  UPDATE: "UPDATE",
  NEW: "NEW",
  REPLACE: "REPLACE",
  DELETE: "DELETE",
  IGNORE: "IGNORE",
});

const ALIASES = {
  "": COMMAND.MERGE,
  MERGE: COMMAND.MERGE,
  UPSERT: COMMAND.MERGE,
  UPDATE: COMMAND.UPDATE,
  NEW: COMMAND.NEW,
  CREATE: COMMAND.NEW,
  REPLACE: COMMAND.REPLACE,
  DELETE: COMMAND.DELETE,
  REMOVE: COMMAND.DELETE,
  IGNORE: COMMAND.IGNORE,
  SKIP: COMMAND.IGNORE,
};

/**
 * Normalize a raw Command cell to a canonical COMMAND value.
 * Blank/whitespace → MERGE. Unknown values throw so a typo'd command is a
 * visible validation error, not a silent no-op.
 *
 * @param {string} [raw]
 * @returns {string} a COMMAND value
 */
export function parseCommand(raw) {
  const key = String(raw ?? "").trim().toUpperCase();
  const cmd = ALIASES[key];
  if (!cmd) throw new Error(`Unknown Command: "${raw}"`);
  return cmd;
}

/** True when the command creates a record if none matches (MERGE, NEW). */
export function commandCanCreate(cmd) {
  return cmd === COMMAND.MERGE || cmd === COMMAND.NEW;
}

/** True when the command requires an existing record (UPDATE, REPLACE, DELETE). */
export function commandRequiresMatch(cmd) {
  return cmd === COMMAND.UPDATE || cmd === COMMAND.REPLACE || cmd === COMMAND.DELETE;
}
