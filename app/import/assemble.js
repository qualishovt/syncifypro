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
 * `top_row` is truthy. If NO row in the file has a truthy `top_row` (e.g. a
 * flat single-row entity like redirects, or a hand-authored file that omits
 * the column), every row is its own record.
 */

const TRUTHY = new Set(["true", "1", "yes", "y", "x"]);

/** Interpret an export/import boolean-ish cell ("TRUE", "true", "1", "x"). */
export function isTruthy(value) {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
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
  if (!hasTopRow) return rows.map((r) => [r]); // flat / single-row entity

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
