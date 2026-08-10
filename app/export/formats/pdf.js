/**
 * export/formats/pdf.js
 *
 * Builds PDF documents with no external dependencies, mirroring the
 * hand-assembled XLSX writer. A PDF is a sequence of numbered objects
 * plus a byte-offset index (xref); we emit uncompressed content
 * streams, so the whole file stays plain latin-1 text.
 *
 * Two entry points, same shape as excel.js:
 *   - toPDF(rows, columns)     — single-table document (direct adapters)
 *   - toPDFDocument(sections)  — one titled table per entity (multi-entity bundle)
 *
 * Layout: each section starts on a fresh page, and the page WIDTH grows
 * to fit every column side by side (spreadsheet-style), from A4
 * landscape up to the 14,400pt viewer limit. Only a table wider than
 * that limit wraps its remaining columns into "bands" — repeated row
 * sets with a "Columns i–j of n" note — so no column is ever dropped.
 *
 * Text uses the base-14 Helvetica fonts (WinAnsi encoding, nothing
 * embedded); characters outside latin-1 degrade to "?".
 *
 * Used by the *direct* export path only — like Excel, the document is
 * built fully in memory, so PDF never routes to bulk operations.
 */

import { resolveColumns, columnHeader } from "./columns.js";

/** @typedef {{ name: string, rows: object[], columns?: string[] }} Section */

// ─── page geometry (points) ──────────────────────────────────────────────────

// The page WIDTH is dynamic: it grows to fit all columns side by side
// (like a spreadsheet), from A4 landscape at minimum up to the 14,400pt
// PDF viewer limit. Only past that limit do columns wrap into bands.
const MIN_PAGE_W = 842;   // A4 landscape
const MAX_PAGE_W = 14400; // hard cap in Acrobat/most viewers
const PAGE_H     = 595;
const MARGIN     = 28;

const TITLE_SIZE = 13;
const HEAD_SIZE  = 7.5;
const BODY_SIZE  = 7;
const NOTE_SIZE  = 6.5;

const HEAD_H   = 16;
const ROW_H    = 13;
const FOOTER_H = 18;
const PAD_X    = 3;
const BAND_GAP = 12;

/**
 * Approximate Helvetica advance width as a fraction of font size.
 * Slightly generous (digits are 0.556 em) so text never overruns its cell.
 */
const CHAR_W = 0.55;

/**
 * Build a multi-section document — one titled table per section.
 *
 * @param {Section[]} sections
 * @returns {Buffer}
 */
export function toPDFDocument(sections) {
  if (sections.length === 0) throw new Error("Document needs at least one section");

  // Pre-pass: resolve every section's columns/widths so the page width
  // can be sized to the widest table (all sections share one page size).
  const layouts = sections.map((s) => {
    const cols = resolveColumns(s.rows, s.columns);
    const widths = columnWidths(s.rows, cols);
    return { cols, widths, tableW: widths.reduce((a, b) => a + b, 0) };
  });
  const pageW = Math.max(
    MIN_PAGE_W,
    Math.min(MAX_PAGE_W, Math.max(...layouts.map((l) => l.tableW)) + MARGIN * 2),
  );
  const availW = pageW - MARGIN * 2;

  const pages = [];
  let ops; // op list of the current page
  let y;   // layout cursor, measured from the TOP of the page

  const newPage = () => { ops = []; pages.push(ops); y = MARGIN; };
  const contentBottom = PAGE_H - MARGIN - FOOTER_H;

  // PDF's origin is bottom-left; helpers take top-based coordinates.
  const text = (x, baseY, str, { bold = false, size = BODY_SIZE, gray = 0 } = {}) => {
    if (!str) return;
    const pre  = gray ? `${num(gray)} g ` : "";
    const post = gray ? " 0 g" : "";
    ops.push(`${pre}BT ${bold ? "/F2" : "/F1"} ${num(size)} Tf ${num(x)} ${num(PAGE_H - baseY)} Td (${esc(toWinAnsi(str))}) Tj ET${post}`);
  };
  const fillRect = (x, top, w, h, gray) => {
    ops.push(`${num(gray)} g ${num(x)} ${num(PAGE_H - top - h)} ${num(w)} ${num(h)} re f 0 g`);
  };
  const hline = (x1, x2, top, gray, width) => {
    ops.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(PAGE_H - top)} m ${num(x2)} ${num(PAGE_H - top)} l S 0 G`);
  };

  const bandWidth = (band) => band.widths.reduce((a, b) => a + b, 0);

  const drawBandHeader = (band, note) => {
    if (note) {
      text(MARGIN, y + NOTE_SIZE, note, { size: NOTE_SIZE, gray: 0.45 });
      y += NOTE_SIZE + 3;
    }
    fillRect(MARGIN, y, bandWidth(band), HEAD_H, 0.92);
    let x = MARGIN;
    band.cols.forEach((col, i) => {
      text(x + PAD_X, y + HEAD_H - 5, fitText(columnHeader(col), band.widths[i], HEAD_SIZE), { bold: true, size: HEAD_SIZE });
      x += band.widths[i];
    });
    y += HEAD_H;
    hline(MARGIN, MARGIN + bandWidth(band), y, 0.55, 0.8);
  };

  const drawRow = (band, row, index) => {
    if (index % 2 === 1) fillRect(MARGIN, y, bandWidth(band), ROW_H, 0.965);
    let x = MARGIN;
    band.cols.forEach((col, i) => {
      text(x + PAD_X, y + ROW_H - 4, fitText(row[col] ?? "", band.widths[i], BODY_SIZE));
      x += band.widths[i];
    });
    y += ROW_H;
    hline(MARGIN, MARGIN + bandWidth(band), y, 0.88, 0.4);
  };

  sections.forEach((section, si) => {
    newPage(); // each section starts on a fresh page
    const rows = section.rows;
    const { cols, widths } = layouts[si];
    const title = `${section.name || `Section ${si + 1}`} — ${rows.length} record${rows.length === 1 ? "" : "s"}`;
    text(MARGIN, y + TITLE_SIZE, title, { bold: true, size: TITLE_SIZE });
    y += TITLE_SIZE + 10;

    if (rows.length === 0 || cols.length === 0) {
      text(MARGIN, y + BODY_SIZE, "No records.", { gray: 0.45 });
      return;
    }

    const bands = packBands(cols, widths, availW, pageW === MIN_PAGE_W);
    bands.forEach((band) => {
      const note = bands.length > 1 ? `Columns ${band.from + 1}–${band.to} of ${cols.length}` : null;
      if (y + (note ? NOTE_SIZE + 3 : 0) + HEAD_H + ROW_H > contentBottom) newPage();
      drawBandHeader(band, note);
      rows.forEach((row, ri) => {
        if (y + ROW_H > contentBottom) {
          newPage();
          drawBandHeader(band, note ? `${note} (continued)` : null);
        }
        drawRow(band, row, ri);
      });
      y += BAND_GAP;
    });
  });

  // Footers need the final page count, so they're stamped last.
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ");
  const footerY = PAGE_H - MARGIN + 8; // baseline sits inside the bottom margin
  pages.forEach((pageOps, i) => {
    ops = pageOps;
    text(MARGIN, footerY, `SyncifyPro export • ${generated} UTC`, { size: NOTE_SIZE, gray: 0.5 });
    const label = `Page ${i + 1} of ${pages.length}`;
    text(pageW - MARGIN - label.length * NOTE_SIZE * CHAR_W, footerY, label, { size: NOTE_SIZE, gray: 0.5 });
  });

  return assemblePdf(pages.map((p) => p.join("\n")), pageW);
}

/**
 * Build a single-table document from flat rows + optional column order.
 * @param {object[]} rows
 * @param {string[]} [columns]
 * @returns {Buffer}
 */
export function toPDF(rows, columns) {
  return toPDFDocument([{ name: "Export", rows, columns }]);
}

// ─── column sizing ────────────────────────────────────────────────────────────

/**
 * Desired width per column, from the header and a sample of the data
 * (capped so one long body_html cell can't claim the whole page).
 *
 * The header renders bold at HEAD_SIZE — larger than the body font — so
 * it gets its own width term; sizing it at BODY_SIZE truncated any
 * header longer than its column's values ("Tags Command" → "Tags Comma…").
 */
function columnWidths(rows, cols) {
  const sample = rows.slice(0, 200);
  return cols.map((col) => {
    const headerW = columnHeader(col).length * HEAD_SIZE * CHAR_W * 1.05; // bold runs a touch wider
    let chars = 0;
    for (const row of sample) {
      const len = String(row[col] ?? "").length;
      if (len > chars) chars = len;
      if (chars >= 48) { chars = 48; break; }
    }
    const bodyW = Math.max(4, Math.min(48, chars)) * BODY_SIZE * CHAR_W;
    return Math.max(headerW, bodyW) + PAD_X * 2;
  });
}

/**
 * Pack columns into bands of at most `availW`. Since the page is sized
 * to the table, this yields a single band in all but the extreme case
 * (a table wider than the 14,400pt page cap), where columns wrap into
 * further bands rather than being dropped.
 *
 * `stretch` fills the width on standard-size pages (capped at 1.6× so a
 * narrow table isn't comically inflated); sized-to-fit pages keep
 * natural column widths.
 */
function packBands(cols, widths, availW, stretch) {
  const bands = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < cols.length; i++) {
    const w = Math.min(widths[i], availW);
    if (i > start && sum + w > availW) {
      bands.push(makeBand(start, i));
      start = i;
      sum = 0;
    }
    sum += w;
  }
  bands.push(makeBand(start, cols.length));
  return bands;

  function makeBand(from, to) {
    let w = widths.slice(from, to).map((x) => Math.min(x, availW));
    if (stretch) {
      const scale = Math.min(availW / w.reduce((a, b) => a + b, 0), 1.6);
      w = w.map((x) => x * scale);
    }
    return { cols: cols.slice(from, to), widths: w, from, to };
  }
}

// ─── text encoding ────────────────────────────────────────────────────────────

/** Common non-latin-1 punctuation → WinAnsi bytes (or ASCII lookalikes). */
const CHAR_FALLBACK = {
  "‘": "'",    "’": "'",    "‚": "'",
  "“": '"',    "”": '"',    "„": '"',
  "–": "\x96", "—": "\x97", "…": "\x85",
  "•": "\x95", "™": "\x99", "€": "\x80",
};

/**
 * Flatten to a WinAnsi-safe single line; anything unmappable becomes "?".
 * Passes 0x80–0x9F through so already-mapped output survives a second
 * call (every string funnels through here via text()).
 */
function toWinAnsi(value) {
  const s = String(value).replace(/[\r\n\t]+/g, " ");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if ((code >= 32 && code <= 126) || (code >= 0x80 && code <= 0xff)) out += ch;
    else if (CHAR_FALLBACK[ch]) out += CHAR_FALLBACK[ch];
    else if (code < 32) out += " ";
    else out += "?";
  }
  return out;
}

/**
 * Truncate to the cell width with a trailing ellipsis (WinAnsi 0x85).
 * The epsilon absorbs float error: a column sized for exactly N chars
 * must admit all N, not floor(N - 1e-15) = N-1.
 */
function fitText(value, width, size) {
  const max = Math.floor((width - PAD_X * 2) / (size * CHAR_W) + 0.001);
  if (max <= 0) return "";
  const s = toWinAnsi(value);
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "\x85" : s;
}

/** Escape a PDF literal string: backslash and unbalanced parens. */
function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const num = (n) => Math.round(n * 100) / 100;

// ─── document assembly ────────────────────────────────────────────────────────

/**
 * Wrap page content streams in the PDF object skeleton:
 * 1 catalog, 2 page tree, 3/4 fonts, then [page, contents] per page,
 * followed by the xref table and trailer.
 *
 * @param {string[]} streams - one content stream per page (latin-1 safe)
 * @param {number} pageW - page width in points (dynamic, sized to content)
 * @returns {Buffer}
 */
function assemblePdf(streams, pageW) {
  const chunks = [];
  const offsets = [];
  let offset = 0;

  const push = (s) => { chunks.push(s); offset += Buffer.byteLength(s, "latin1"); };
  const addObj = (n, body) => { offsets[n] = offset; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push("%PDF-1.4\n");

  const pageObjNums = streams.map((_, i) => 5 + i * 2);
  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObj(2, `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${streams.length} >>`);
  addObj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  addObj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  streams.forEach((stream, i) => {
    const pageNum = 5 + i * 2;
    addObj(pageNum, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNum + 1} 0 R >>`);
    addObj(pageNum + 1, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });

  const xrefOffset = offset;
  const count = 5 + streams.length * 2;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(""), "latin1");
}
