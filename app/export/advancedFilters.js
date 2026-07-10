/**
 * export/advancedFilters.js
 *
 * The export "advanced filter" builder (column + operator + value) filters on
 * arbitrary export columns — including ones Shopify's search syntax can't
 * express — so it's applied to the exported ROWS after fetch rather than as a
 * `query` clause.
 *
 * Filtering is per RECORD, not per row: a product explodes into one row per
 * variant/image, and only the record's first row (its `top_row`) carries the
 * record-level fields. So we group rows by that marker, test each group's top
 * row, and keep or drop the whole group — a matching product keeps all its rows.
 *
 * Values are matched case-insensitively. An "any of" operator's value is a
 * comma-separated list (matches if any entry matches). IDs are stored as GIDs
 * (gid://shopify/Product/123) but merchants type the bare numeric id from the
 * admin URL, so a GID cell also matches on its trailing numeric segment.
 */

const VALUELESS = new Set(["is_empty", "is_not_empty"]);

/** Trailing segment of a GID (the numeric id), or the string unchanged. */
function gidTail(s) {
  return s.startsWith("gid://") ? s.split("/").pop() : s;
}

/** The "any of" value list: comma-separated, trimmed, lowercased, non-empty. */
function valueList(value) {
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== "");
}

/** Does one cell satisfy an operator against the value list? */
function matchOne(cell, operator, values) {
  const raw = String(cell ?? "").trim().toLowerCase();
  const tail = gidTail(raw); // numeric id when raw is a GID, else raw
  const eq = (v) => v === raw || v === tail;
  const has = (v) => raw.includes(v) || tail.includes(v);
  const starts = (v) => raw.startsWith(v) || tail.startsWith(v);
  switch (operator) {
    case "is_empty":        return raw === "";
    case "is_not_empty":    return raw !== "";
    case "equals_any":      return values.some(eq);
    case "not_equal_any":   return !values.some(eq);
    case "contains_any":    return values.some(has);
    case "contains_none":   return !values.some(has);
    case "starts_with_any": return values.some(starts);
    default:                return true; // unknown operator → don't exclude
  }
}

/** Active, well-formed filters (a value is required unless the op is valueless). */
export function activeAdvancedFilters(advancedFilters) {
  return (advancedFilters ?? []).filter((f) =>
    f && f.column && f.operator &&
    (VALUELESS.has(f.operator) || String(f.value ?? "").trim() !== ""));
}

/** True if a record's top row satisfies every active advanced filter (AND). */
export function matchesAdvancedFilters(top, advancedFilters) {
  return activeAdvancedFilters(advancedFilters).every((f) =>
    matchOne(top?.[f.column], f.operator, valueList(f.value)));
}

/**
 * Group exported rows into records. Entities that explode (products, orders)
 * mark each record's first row with a truthy `top_row`; entities that don't
 * carry no marker, so each row is its own record.
 */
function groupRows(rows) {
  const hasMarkers = rows.some((r) => String(r.top_row ?? "").trim() !== "");
  if (!hasMarkers) return rows.map((r) => [r]);
  const groups = [];
  for (const r of rows) {
    if (groups.length === 0 || String(r.top_row ?? "").trim() !== "") groups.push([r]);
    else groups[groups.length - 1].push(r);
  }
  return groups;
}

/**
 * Filter exported rows by the advanced-filter builder. Returns the rows
 * unchanged when there are no active filters.
 *
 * @param {object[]} rows
 * @param {{column: string, operator: string, value?: string}[]} [advancedFilters]
 * @returns {object[]}
 */
export function applyAdvancedFilters(rows, advancedFilters) {
  const active = activeAdvancedFilters(advancedFilters);
  if (active.length === 0 || !Array.isArray(rows) || rows.length === 0) return rows;
  return groupRows(rows)
    .filter((group) => matchesAdvancedFilters(group[0], active))
    .flat();
}
