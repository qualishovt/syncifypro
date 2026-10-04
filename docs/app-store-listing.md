# App Store listing — SyncifyPro

State of the Partner Dashboard listing, and what is still outstanding.
Field limits are from
[Best practices for apps in the Shopify App Store](https://shopify.dev/docs/apps/launch/app-requirements-checklist).

Listing editor lives at **Dev Dashboard → the app → the distribution link**, which
lands on `apps.shopify.com/services/partner-app-submissions/<client-id>/en`.
It is no longer in the Partner Dashboard app nav, so the old URLs 404.
Pricing plans are a separate screen: `apps.shopify.com/services/pricing/<client-id>`.

---

## Live as of 2026-10-04

**Integrations** (was empty; max 6, five claimed, each verified against the code):

| Integration | Implemented in |
|---|---|
| Google Drive | `DESTINATIONS` in [app.scheduler.jsx](../app/routes/app.scheduler.jsx), `schedules/google.server.js` |
| Google Sheets | same |
| FTP / SFTP | scheduler destinations + `ImportServer` credentials |
| Amazon S3 | `DESTINATIONS` in [app.scheduler.jsx](../app/routes/app.scheduler.jsx) |
| Google Shopping | [formats/googleFeed.js](../app/export/formats/googleFeed.js), [export/templates.js](../app/export/templates.js) |

**Do not add** the migration platforms (WooCommerce, Magento, BigCommerce,
PrestaShop, OpenCart). The field excludes "other shopping carts (unless you
provide synchronization)" — SyncifyPro pulls one way, it does not sync.
Matrixify migrates from the same platforms and lists none of them either.
Dropbox would be the natural sixth but is not implemented.

**Subtitle:** "Bulk export, import & update via Excel, CSV, FTP & Drive" (56/62).
Only ever appears on app *cards* in search and recommendations, never on the
listing page itself, so it shows up once the search index refreshes.

**Plan copy**, rewritten after the free-tier change:

| Plan | Display name | Features |
|---|---|---|
| basic | Basic | 1,000 rows per import or export · All data types included · Excel, CSV, XML and JSON files |
| pro | Pro | 10,000 rows · Scheduled exports and imports · Migrations from other platforms |
| max | Max | 100,000 rows · Scheduled exports and imports · Migrations from other platforms |
| enterprise | Enterprise | Unlimited rows · Priority support · Schedules and migrations included |

---

## Pending: taxonomy appeal, submitted 2026-10-04

Categories are **not** self-serve — the App category section links to a Google
Form ("Taxonomy Appeals", `https://forms.gle/5JURcJcA553ELGHs8`) and Shopify's
team decides. **Limit of 2 tags per app.**

Requested: **add `Bulk editor`**, remove nothing (the listing had one tag,
`Store data importer`). The case made: the import path performs bulk edits;
the listing's own category detail tags already say "Bulk updates", "Bulk
import" and "Bulk export"; and both closest comparables carry both tags —
Matrixify, and Altera, whose *primary* tag is Bulk editor.

Submitting the form **pauses all Category Ads campaigns**. There were none.

---

## Deliberately left alone

- **App name** — `SyncifyPro: Export & Import` (27/30). `SyncifyPro: Bulk Export
  Import` would fit in exactly 30 and spend the spare characters on a real
  search term, but renaming risks re-review. Not done.
- **Search terms** — already full at the maximum of 5: `bulk edit`, `excel`,
  `export`, `import`, `migration`. These are a better spread than any
  replacement set; leave them.
- **Demo store URL** — empty, and the field is marked **optional** in the
  editor. (The general docs call it "required for most apps"; the field wins.)
  It is written for storefront-facing apps: SyncifyPro is admin-only, so there
  is nothing a merchant could see without admin access to the dev store. The
  screenshots and the 2–3 minute video carry this job instead.

## Mechanics worth remembering

- **Prices propagate automatically** — "Changes to prices and billing cycles will
  be updated automatically". Changing a price needs no listing edit at all.
- **Plan display names and feature bullets do not.** They are listing content,
  authored separately and reviewed.
- **Deleting a plan deletes its listing copy with it.** Recreating the plan
  leaves the name and features blank, and that only surfaces as "Display name
  is required" the next time the editor is opened. Caught this the hard way on
  2026-10-04 — see [[billing-plan-gating]].
- Ref-based clicks do not register on these pages; drive them by screenshot
  coordinates, and re-screenshot after each field, because a validation error
  clearing shifts the layout.
