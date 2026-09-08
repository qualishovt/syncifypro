/**
 * import/assemble.js
 *
 * The inverse of the export normalizer's "explode". Export flattens one
 * record into several rows — a product becomes a top row plus extra rows for
 * variants / images / inventory; an order becomes a top row plus line-item,
 * transaction, refund, and fulfillment rows. The first row of each record is
 * marked with a truthy `top_row`; the rest carry only their own child data.
 *
 * Assembly regroups those flat rows back into one group per record so a
 * writer can rebuild the object. It is intentionally entity-agnostic: it only
 * splits the row stream into records. Interpreting the child rows (which are
 * variants vs. transactions, etc.) is the writer's job, since that shape is
 * entity-specific.
 *
 * Splitting rule: a new record begins at the first row and at every row whose
 * `top_row` is truthy. If NO row in the file has a truthy `top_row` (a flat
 * single-row entity like redirects, a hand-authored file, or Shopify's own
 * CSV export), rows are grouped by identity instead: the record's identifier
 * column is whichever of id / handle / email / name / … its first row fills,
 * and a following row continues the record when that column holds the same
 * value, or is empty AND the row is a child row — one that carries no
 * record-level field (Title, Command): the variant and image rows under a
 * product in Shopify's CSV, or Matrixify-style child rows. A row with an
 * empty identifier but a Title/Command is a new record (a "create" row after
 * an "update" row). Rows that carry no identifier at all stay one record
 * each, so a plain "create these" file still works — but their own child
 * rows (no identifier, no Title/Command) still attach to them.
 *
 * Without this, a Shopify CSV's three image rows for one handle became three
 * concurrent productSet calls on the same product (each replacing its media
 * with a single image), and Shopify rejected most of them with "This product
 * is currently being modified".
 */

const TRUTHY = new Set(["true", "1", "yes", "y", "x"]);

/** Interpret an export/import boolean-ish cell ("TRUE", "true", "1", "x"). */
export function isTruthy(value) {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
}

// Identifier columns in precedence order (union across entities: products/
// collections use handle, customers email, orders name, redirects path, …).
const IDENTITY_KEYS = ["id", "handle", "email", "name", "path", "code"];

// Filling one of these marks a row as a record of its own even when its
// identifier column is empty (a "create" row below an "update" row).
const RECORD_KEYS = ["command", "title"];

const norm = (v) => String(v ?? "").trim().toLowerCase();
const startsRecord = (row) => RECORD_KEYS.some((k) => norm(row?.[k]) !== "");

/** The first identifier column a row fills, or null when it carries none. */
function identityKeyOf(row) {
  for (const k of IDENTITY_KEYS) if (norm(row?.[k]) !== "") return k;
  return null;
}

/**
 * Split flat rows into record groups.
 *
 * @param {object[]} rows - header-normalized rows (snake_case keys)
 * @param {object} [opts]
 * @param {string} [opts.topRowKey="top_row"] - column marking a record's first row
 * @returns {object[][]} array of record groups, each an array of its rows
 */
export function groupRecords(rows, { topRowKey = "top_row" } = {}) {
  if (rows.length === 0) return [];

  const hasTopRow = rows.some((r) => isTruthy(r[topRowKey]));
  if (!hasTopRow) return groupByIdentity(rows);

  const groups = [];
  let current = null;
  for (const row of rows) {
    if (current === null || isTruthy(row[topRowKey])) {
      current = [];
      groups.push(current);
    }
    current.push(row);
  }
  return groups;
}

function groupByIdentity(rows) {
  const groups = [];
  let current = null;
  let key = null;   // the open record's identifier column …
  let value = "";   // … and its value
  for (const row of rows) {
    const cell = key ? norm(row[key]) : "";
    const child = !startsRecord(row) && (key ? cell === "" : identityKeyOf(row) === null);
    const continues = current !== null && ((key !== null && cell === value) || child);
    if (!continues) {
      current = [];
      groups.push(current);
      key = identityKeyOf(row);
      value = key ? norm(row[key]) : "";
    }
    current.push(row);
  }
  return groups;
}

/**
 * The top (parent) row of a group is its first row — it carries the
 * record-level fields (id, title, command, …). Convenience accessor so
 * writers don't reach into `group[0]` directly.
 *
 * @param {object[]} group
 * @returns {object}
 */
export function topRow(group) {
  return group[0];
}
