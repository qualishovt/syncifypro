/**
 * export/formats/pdf.test.js
 *
 * The PDF writer emits uncompressed content streams, so the assertions
 * can read cell text straight out of the file bytes.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toPDF, toPDFDocument } from "./pdf.js";

test("toPDF produces a well-formed single-page PDF with escaped cell text", () => {
  const buf = toPDF(
    [{ sku: "A-1", title: "Widget (blue) 50% off \\ deal" }],
    ["sku", "title"],
  );
  const s = buf.toString("latin1");

  assert.ok(s.startsWith("%PDF-1.4"), "starts with PDF header");
  assert.ok(s.trimEnd().endsWith("%%EOF"), "ends with EOF marker");
  assert.match(s, /\/Count 1/);
  assert.match(s, /xref/);
  assert.match(s, /startxref/);
  // Parens and backslashes must be escaped inside literal strings.
  assert.ok(s.includes("Widget \\(blue\\) 50% off \\\\ deal"), "cell text escaped");
});

test("multi-section documents start each entity on its own page", () => {
  const buf = toPDFDocument([
    { name: "Products",  rows: [{ a: "1" }], columns: ["a"] },
    { name: "Customers", rows: [{ b: "2" }], columns: ["b"] },
  ]);
  const s = buf.toString("latin1");

  assert.match(s, /\/Count 2/);
  assert.ok(s.includes("Products \x97 1 record"), "title with em dash + count");
  assert.ok(s.includes("Customers \x97 1 record"));
});

test("long value sets paginate and repeat the header", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
  const buf = toPDF(rows, ["id", "name"]);
  const s = buf.toString("latin1");

  const pageCount = Number(s.match(/\/Count (\d+)/)[1]);
  assert.ok(pageCount >= 2, `expected 2+ pages, got ${pageCount}`);
  assert.ok(s.includes("(Row 0)"), "first row present");
  assert.ok(s.includes("(Row 119)"), "last row present");
  assert.ok(s.includes(`Page ${pageCount} of ${pageCount}`), "footer page numbers");
});

test("wide tables grow the page width instead of wrapping columns", () => {
  const row = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`col_${i}`, `value_${i}_${"x".repeat(30)}`]),
  );
  const buf = toPDF([row], Object.keys(row));
  const s = buf.toString("latin1");

  const pageW = Number(s.match(/\/MediaBox \[0 0 ([\d.]+) 595\]/)[1]);
  assert.ok(pageW > 842, `page should be wider than A4, got ${pageW}`);
  assert.ok(!/Columns 1\x96\d+ of 40/.test(s), "no band wrapping below the width cap");
  assert.ok(s.includes("(value_39_"), "last column present on the same page");
});

test("tables wider than the 14,400pt viewer cap fall back to column bands", () => {
  const row = Object.fromEntries(
    Array.from({ length: 90 }, (_, i) => [`col_${i}`, `value_${i}_${"x".repeat(40)}`]),
  );
  const buf = toPDF([row], Object.keys(row));
  const s = buf.toString("latin1");

  assert.match(s, /\/MediaBox \[0 0 14400 595\]/, "page capped at the viewer limit");
  assert.match(s, /Columns 1\x96\d+ of 90/, "band note present past the cap");
  assert.ok(s.includes("(value_89_"), "last column not dropped");
});

test("non-latin-1 characters degrade to '?' without corrupting the stream", () => {
  const buf = toPDF([{ name: "日本語 – ok" }], ["name"]);
  const s = buf.toString("latin1");

  assert.ok(s.includes("(??? \x96 ok)"), "CJK replaced, en dash mapped to WinAnsi");
});

test("empty row sets still render a titled section", () => {
  const s = toPDF([], ["sku"]).toString("latin1");
  assert.ok(s.includes("Export \x97 0 records"));
  assert.ok(s.includes("(No records.)"));
});
