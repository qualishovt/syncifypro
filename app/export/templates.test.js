import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_TEMPLATES, templateById } from "./templates.js";

test("every template is addressable and uniquely named", () => {
  const ids = EXPORT_TEMPLATES.map((t) => t.id);
  const names = EXPORT_TEMPLATES.map((t) => t.name);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
  for (const t of EXPORT_TEMPLATES) assert.equal(templateById(t.id), t);
  assert.equal(templateById("nope"), null);
});

test("a template's name can't be mistaken for the page's own entries", () => {
  for (const t of EXPORT_TEMPLATES) {
    assert.notEqual(t.name, "New Export");
    assert.notEqual(t.name, "Latest Export");
    assert.ok(!t.name.startsWith("__"), `${t.name} uses a reserved name`);
  }
});

test("each feed exports active products in the feed format", () => {
  for (const t of EXPORT_TEMPLATES) {
    assert.equal(t.format, "google_feed", `${t.name} claims a layout we don't produce`);
    assert.deepEqual(t.specs.map((s) => s.entity), ["products"]);
    assert.equal(t.specs[0].filters.status, "active");
    // No column selection: the feed adapter picks its own fields.
    assert.equal(t.specs[0].fields, undefined);
  }
});

test("each feed names its file distinctly and datestamps it", () => {
  const names = EXPORT_TEMPLATES.map((t) => t.options.filename);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /\{date\}/);
});
