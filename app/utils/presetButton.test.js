import { test } from "node:test";
import assert from "node:assert/strict";
import { presetButton } from "./presetButton.js";

test("an untouched page offers nothing to save", () => {
  assert.equal(presetButton({ picked: "none", dirty: false }), null);
  assert.equal(presetButton({ picked: "saved", dirty: false }), null);
});

test("no preset, page changed → Save as with the star", () => {
  assert.equal(presetButton({ picked: "none", dirty: true }), "saveAsStar");
});

test("latest export can always be kept under a name", () => {
  assert.equal(presetButton({ picked: "latest", dirty: false }), "saveAs");
  assert.equal(presetButton({ picked: "latest", dirty: true }), "saveAsStar");
});

test("a saved preset that drifted offers Update, never Save as", () => {
  assert.equal(presetButton({ picked: "saved", dirty: true }), "update");
});

test("only ever one button", () => {
  for (const picked of ["none", "latest", "saved", "template"]) {
    for (const dirty of [true, false]) {
      const shown = presetButton({ picked, dirty });
      assert.ok(shown === null || typeof shown === "string");
    }
  }
});

test("a template can always be kept as a preset of one's own", () => {
  assert.equal(presetButton({ picked: "template", dirty: false }), "saveAs");
  assert.equal(presetButton({ picked: "template", dirty: true }), "saveAsStar");
});

test("a template is never updated in place", () => {
  for (const dirty of [true, false]) {
    assert.notEqual(presetButton({ picked: "template", dirty }), "update");
  }
});
