# Paid pricing model (suspended 2026-10-09)

SyncifyPro was made free on 2026-10-09 to win its first installs. This is the
paid model that was live until then, recorded exactly so it can be restored.

## Tiers

| Plan | Price | Rows per import/export job | Schedules | Migrations |
|---|---|---|---|---|
| Basic | Free | 1,000 | — | — |
| Pro | $12/month | 10,000 | yes | yes |
| Max | $40/month | 100,000 | yes | yes |
| Enterprise | $150/month | unlimited | yes | yes (+ priority support) |

The gating lives in `app/billing.server.js` (`TIERS`, `getTieredPlan`) and is
still covered by `app/billing.test.js`. Only `EVERYTHING_FREE = true` switches
it off. Tiers are matched by the subscription's **name**, so the plan names
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
| Basic | 1,000 rows per import or export · All data types included · Excel, CSV, XML and JSON files |
| Pro | 10,000 rows per import or export · Scheduled exports and imports · Migrations from other platforms |
| Max | 100,000 rows per import or export · Scheduled exports and imports · Migrations from other platforms |
| Enterprise | Unlimited rows per import or export · Priority support · Schedules and migrations included |

## Restoring it

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
