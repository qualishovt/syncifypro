# Paid pricing model

**Live** (restored 2026-10-14, with the free cap cut from 1,000 to 100 rows).
It was suspended 2026-10-09 → 2026-10-14 while the app was free. Everything
needed to switch between the two — plan settings, listing copy, and the order
to do it in — is recorded here.

## Tiers

| Plan | Price | Rows per import/export job | Schedules | Migrations |
|---|---|---|---|---|
| Basic | Free | 100 | — | — |
| Pro | $12/month | 10,000 | yes | yes |
| Max | $40/month | 100,000 | yes | yes |
| Enterprise | $150/month | unlimited | yes | yes (+ priority support) |

The gating lives in `app/billing.server.js` (`TIERS`, `getTieredPlan`) and is
covered by `app/billing.test.js`. `EVERYTHING_FREE = true` switches it off. Tiers are matched by the subscription's **name**, so the plan names
below must stay exactly Basic / Pro / Max / Enterprise.

## Partner-dashboard plans (Shopify Managed Pricing)

Plan editor: `https://apps.shopify.com/services/pricing/30e7a0bb86f2c0ee2931e2a196467506`
(also reached from the listing editor → Pricing details → Manage).

| Plan name (invoices) | Handle | Billing | Charge | Free trial | Free on dev stores | Redirect URL |
|---|---|---|---|---|---|---|
| Basic | `basic` | no subscription charge | Free | — | no | `/app` |
| Pro | `pro` | Monthly recurring | $12 | 0 days | **yes** | `/app` |
| Max | `max` | Monthly recurring | $40 | 0 days | no | `/app` |
| Enterprise | `enterprise` | Monthly recurring | $150 | 0 days | no | `/app` |

No usage charges. A private `shopify-test` $0 plan is created by Shopify
automatically and is not ours to manage.

## Listing copy (Pricing details, per plan)

Deleting a plan wipes its listing copy, so it must be re-entered after the
plan is recreated.

| Display name | Top features |
|---|---|
| Basic | 100 rows per import or export · All data types included · Excel, CSV, XML and JSON files |
| Pro | 10,000 rows per import or export · Scheduled exports and imports · Migrations from other platforms |
| Max | 100,000 rows per import or export · Scheduled exports and imports · Migrations from other platforms |
| Enterprise | Unlimited rows per import or export · Priority support · Schedules and migrations included |

## Restoring it (free → paid)

Order matters: paid plans with the free flag on bill merchants for nothing;
the flag off with no paid plans caps every shop at Basic with no upgrade path.

1. Partner dashboard: recreate Pro, Max and Enterprise with the settings above.
   Deleted handles are reusable, so they come back as `pro`/`max`/`enterprise`.
   Plan name and handle can't be edited after creation, so type them exactly.
2. Listing editor → Pricing details: re-enter the display names and features
   above, and set Basic's back if it was changed. Save.
3. Code: `EVERYTHING_FREE = false` in `app/billing.server.js`; in
   `app/billing.test.js` change the "app is free" test back to asserting the
   flag is off. Commit, push, deploy.
4. The Settings → Plan card and the upgrade prompts come back on their own —
   they read the flag.

## Making it free again (paid → free)

1. Code: `EVERYTHING_FREE = true`; flip the "charging is on" test to assert
   the flag is on and that getPlan gives everything. Commit, push, deploy.
2. Partner dashboard: delete Pro, Max and Enterprise (subscribers stay
   subscribed). Keep Basic.
3. Listing editor → Pricing details: Basic's display name "Free", features
   "Unlimited rows per import or export · Scheduled exports and imports ·
   Migrations from other platforms". Save.
