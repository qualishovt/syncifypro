/**
 * Plan gating. The app charges again, so these cover what getPlan() makes of
 * the live subscription state — including the two ways it must fail safely:
 * an unrecognised plan name over-delivers, a broken billing API under-delivers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPlan, EVERYTHING_FREE, FREE_ROW_LIMIT } from "./billing.server.js";

/** An admin client answering the subscription query with `subs`. */
const adminWith = (subs) => ({
  graphql: async () => ({
    json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: subs } } }),
  }),
});

const active = (name) => [{ name, status: "ACTIVE", test: false }];

test("no subscription means Basic limits", async () => {
  const plan = await getPlan(adminWith([]));
  assert.equal(plan.planName, "Basic");
  assert.equal(plan.rowLimit, FREE_ROW_LIMIT);
  assert.equal(plan.schedules, false);
  assert.equal(plan.migrations, false);
});

test("the free cap fits a whole small-store job, and Pro is still 10x it", () => {
  // The cap exists to prompt an upgrade, not to stop a merchant mid-job: at
  // 100 rows nobody ever saw an export finish. Change it on purpose.
  assert.equal(FREE_ROW_LIMIT, 1_000);
});

test("an active plan is matched by name, whatever its case", async () => {
  for (const name of ["Pro", "pro", "  PRO  "]) {
    const plan = await getPlan(adminWith(active(name)));
    assert.equal(plan.planName, "Pro", `"${name}" should match the Pro tier`);
    assert.equal(plan.rowLimit, 10_000);
    assert.equal(plan.schedules, true);
  }
});

test("the paid tiers carry their own row limits", async () => {
  assert.equal((await getPlan(adminWith(active("Max")))).rowLimit, 100_000);
  assert.equal((await getPlan(adminWith(active("Enterprise")))).rowLimit, null);
});

test("a cancelled subscription is not an active one", async () => {
  const plan = await getPlan(adminWith([{ name: "Pro", status: "CANCELLED", test: false }]));
  assert.equal(plan.planName, "Basic", "only ACTIVE subscriptions count");
});

test("an unrecognised plan name over-delivers rather than capping a payer", async () => {
  const plan = await getPlan(adminWith(active("Agency Annual")));
  assert.equal(plan.rowLimit, null, "a renamed plan must not cap someone who is paying");
  assert.equal(plan.schedules, true);
  assert.equal(plan.planName, "Agency Annual", "and keeps its own name for the UI");
});

test("a billing API failure falls back to Basic instead of taking the app down", async () => {
  const exploding = { graphql: () => { throw new Error("billing API down"); } };
  const plan = await getPlan(exploding);
  assert.equal(plan.planName, "Basic");
  assert.equal(plan.rowLimit, FREE_ROW_LIMIT);
});

test("the free kill switch is off", () => {
  // If this ever fails, the Partner dashboard plans must come down in the same
  // change — paid plans plus a free-for-all flag bills merchants for nothing.
  assert.equal(EVERYTHING_FREE, false);
});
