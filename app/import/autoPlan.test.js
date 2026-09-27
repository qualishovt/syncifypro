import { test } from "node:test";
import assert from "node:assert/strict";
import { autoPlan } from "./autoPlan.js";

test("a recognised sheet is included as what it was detected to be", () => {
  assert.deepEqual(
    autoPlan({ sheets: [{ ok: true, entity: "products" }] }),
    [{ entity: "products", include: true }],
  );
});

test("an unrecognised sheet waits to be told what it is", () => {
  assert.deepEqual(
    autoPlan({ sheets: [{ ok: false, entity: "products" }] }),
    [{ entity: "auto", include: false }],
  );
});

test("sheet order is kept — the plan is paired with the preview by position", () => {
  const plan = autoPlan({ sheets: [
    { ok: true, entity: "products" },
    { ok: false },
    { ok: true, entity: "customers" },
  ] });
  assert.deepEqual(plan.map((p) => p.entity), ["products", "auto", "customers"]);
});

test("no preview yields no plan rather than throwing", () => {
  assert.deepEqual(autoPlan(null), []);
  assert.deepEqual(autoPlan({}), []);
});
