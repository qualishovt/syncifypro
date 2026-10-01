/**
 * While the app is free, nothing may cap a merchant: no row limit, and the
 * scheduling/migration gates must pass without a subscription of any kind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPlan, EVERYTHING_FREE } from "./billing.server.js";

// An admin client that would FAIL if it were called — while the app is free,
// the plan must not depend on Shopify answering a billing query at all.
const explodingAdmin = { graphql: () => { throw new Error("billing API must not be consulted while free"); } };

test("a shop with no subscription gets everything", async () => {
  const plan = await getPlan(explodingAdmin);
  assert.equal(plan.rowLimit, null, "no row cap");
  assert.equal(plan.schedules, true);
  assert.equal(plan.migrations, true);
  assert.equal(plan.paid, false);
});

test("the free switch is what drives it", () => {
  assert.equal(EVERYTHING_FREE, true, "flip this (and the Partner dashboard prices) to charge again");
});

test("the plan reports itself as Free, for the UI to show", async () => {
  assert.equal((await getPlan(explodingAdmin)).planName, "Free");
});
