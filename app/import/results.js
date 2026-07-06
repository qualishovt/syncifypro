/**
 * import/results.js
 *
 * Builds the downloadable "import results" workbook — Matrixify's post-import
 * artifact. It echoes back the imported rows with two extra columns per record —
 * "Import Result" (Created / Updated / Deleted / Skipped / Failed) and "Import
 * Comment" (the error, if any) — so a merchant can see exactly what happened to
 * each row and fix + re-import. A leading Summary sheet tallies each sheet.
 *
 * Pure: takes the per-sheet results the worker collected and returns an .xlsx
 * Buffer via the existing zero-dependency Excel writer.
 */

import { toExcelWorkbook } from "../export/formats/excel.js";
import { reverseHeaderMap } from "./headers.js";
import { groupRecords } from "./assemble.js";

// Title-Case keys so the Excel writer's columnHeader() (which humanizes only
// keys present in FIELD_LABELS) passes them through verbatim.
const SUMMARY_COLUMNS = [
  "Sheet", "Entity", "Parsed", "Valid", "Invalid",
  "Created", "Updated", "Deleted", "Skipped", "Failed", "Note",
];
const ERROR_COLUMNS = ["Identifier", "Field", "Message"];
const RESULT_COL = "Import Result";
const COMMENT_COL = "Import Comment";

/**
 * @param {object[]} sheetResults - one per analyzed sheet:
 *   { name, entity, ok, parsed, valid, invalid, reason?, detectedColumns?,
 *     validRows?, res? } where res = { created, updated, deleted, skipped,
 *     errors, results:[{status,comment}] } from the writer.
 * @returns {Buffer} .xlsx workbook
 */
export function buildResultsWorkbook(sheetResults) {
  const summaryRows = sheetResults.map((s) => ({
    Sheet:   s.name ?? "(sheet)",
    Entity:  s.entity ?? "—",
    Parsed:  s.parsed ?? 0,
    Valid:   s.valid ?? 0,
    Invalid: s.invalid ?? 0,
    Created: s.res?.created ?? 0,
    Updated: s.res?.updated ?? 0,
    Deleted: s.res?.deleted ?? 0,
    Skipped: s.res?.skipped ?? 0,
    Failed:  s.res?.errors?.length ?? 0,
    Note:    s.ok ? "" : (s.reason ?? "skipped"),
  }));

  const used = new Set(["Summary"]);
  const sheets = [{ name: "Summary", rows: summaryRows, columns: SUMMARY_COLUMNS }];

  // One annotated sheet per imported entity: the rows + Import Result/Comment.
  for (const s of sheetResults) {
    if (!s.ok) continue;
    const annotated = annotateSheet(s, used);
    if (annotated) sheets.push(annotated);
  }

  // Per-entity error appendix (captures follow-up-pass errors that aren't tied
  // to a single record's main result, e.g. inventory / publication / consent).
  for (const s of sheetResults) {
    const errs = s.res?.errors ?? [];
    if (errs.length === 0) continue;
    sheets.push({
      name: uniqueName(`${titleCase(s.entity)} Errors`, used),
      rows: errs.map(normalizeError),
      columns: ERROR_COLUMNS,
    });
  }

  return toExcelWorkbook(sheets);
}

/**
 * Echo a sheet's imported rows back with the two result columns. One record can
 * span several rows (a product + its variants); the result lands on the
 * record's first row, continuation rows are left blank.
 */
function annotateSheet(s, used) {
  const records = groupRecords(s.validRows ?? []);
  if (!records.length) return null;
  const outcomes = s.res?.results ?? [];

  let map;
  try { map = reverseHeaderMap(s.entity); } catch { map = new Map(); }
  const cols = s.detectedColumns ?? [];

  const rows = [];
  records.forEach((group, i) => {
    const o = outcomes[i] ?? {};
    group.forEach((r, ri) => {
      const row = {};
      for (const header of cols) {
        const key = map.get(header) ?? header; // header → snake_case key
        row[header] = r[key] ?? "";
      }
      row[RESULT_COL]  = ri === 0 ? titleCase(o.status ?? "processed") : "";
      row[COMMENT_COL] = ri === 0 ? (o.comment ?? "") : "";
      rows.push(row);
    });
  });

  return {
    name: uniqueName(s.name || titleCase(s.entity), used),
    rows,
    columns: [...cols, RESULT_COL, COMMENT_COL],
  };
}

/** Writers key errors by different identifiers; flatten to a common shape. */
function normalizeError(e) {
  const identifier =
    e.title ?? e.handle ?? e.name ?? e.path ?? e.customer ?? e.product ??
    e.order ?? e.id ?? "(unknown)";
  const message =
    e.message ??
    (Array.isArray(e.userErrors)
      ? e.userErrors.map((u) => u.message).filter(Boolean).join("; ")
      : "") ??
    "";
  return { Identifier: String(identifier), Field: e.field ?? "", Message: message };
}

/** Excel sheet names must be unique and ≤31 chars — trim + de-duplicate. */
function uniqueName(name, used) {
  let base = String(name || "Sheet").slice(0, 31);
  let out = base;
  let n = 2;
  while (used.has(out)) {
    const suffix = ` (${n++})`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(out);
  return out;
}

function titleCase(s) {
  return String(s ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Sheet";
}
