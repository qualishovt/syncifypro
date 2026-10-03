# App Store listing — SyncifyPro

Draft copy for the Partner Dashboard listing fields. Nothing here is published;
every value needs pasting in by hand, and listing edits trigger re-review.

Field limits below are from
[Best practices for apps in the Shopify App Store](https://shopify.dev/docs/apps/launch/app-requirements-checklist).

**Live listing today:** name `SyncifyPro: Export & Import`, subtitle
"Bulk export, import, and migration for your store data", one category
(Store data importer), **no integrations**, 0 reviews.

---

## 1. Integrations — max 6, currently empty

The field's own rule: *don't include Shopify itself, other shopping carts
(unless you provide synchronization), or other Shopify apps (unless you
directly integrate with them).*

Five are truthfully claimable, each verified against the code:

| Integration | Implemented in |
|---|---|
| Google Drive | `DESTINATIONS` in [app.scheduler.jsx:58](../app/routes/app.scheduler.jsx:58), `schedules/google.server.js` |
| Google Sheets | same |
| FTP / SFTP | [app.scheduler.jsx:1320](../app/routes/app.scheduler.jsx:1320) + `ImportServer` credentials |
| Amazon S3 | `DESTINATIONS` in [app.scheduler.jsx:60](../app/routes/app.scheduler.jsx:60) |
| Google Shopping | [formats/googleFeed.js](../app/export/formats/googleFeed.js), [export/templates.js](../app/export/templates.js) |

**Deliberately left out — do not add these:**

- **WooCommerce, Magento, BigCommerce, PrestaShop, OpenCart.** These are
  migration *sources* — a one-way pull, not synchronization — so the field's
  shopping-cart exclusion applies. Matrixify migrates from the same platforms
  and lists none of them as integrations either.
- **Shopify Admin / Shopify Files.** Shopify itself; excluded by the rule.
  (Matrixify does list "Shopify Admin"; don't copy it.)
- **Dropbox.** Not implemented — zero references in the codebase. It would be
  the natural 6th slot and is a small addition to the delivery layer, so worth
  building before claiming.

Six is a ceiling, not a quota. Ship the five true ones.

---

## 2. Demo store URL — the one item that isn't an afternoon

The docs call this *required for most apps*, and describe it as showcasing the
app "on a development store with contextual instructions to guide merchants
through the experience."

That is written for storefront-facing apps. SyncifyPro is admin-only: it adds
nothing to a storefront, and a merchant cannot log into your dev store to see
the admin UI. So there is no URL that straightforwardly satisfies this.

Practical options, cheapest first:

1. **Lean on screenshots + video instead.** 3–6 desktop stills at 1600×900, and
   a 2–3 minute video. The video is the real conversion lever for an admin app,
   and there's already a working screencast setup for it.
2. **A public walkthrough page** on `app.syncifypro.app` — annotated screens of
   an export being configured, run, and downloaded. Honest, and it gives the
   field something real to point at.
3. **A seeded dev store with reviewer access**, which is what the field
   literally asks for and the most work by far.

Recommendation: 1 and 2, and leave the URL field pointing at the walkthrough
page. Confirm with Shopify review whether they'll accept that for an
admin-only app rather than guessing.

---

## 3. Keyword fields

### App name — 30 char max

| | Value | Chars |
|---|---|---|
| Current | `SyncifyPro: Export & Import` | 27 |
| Option A | `SyncifyPro: Bulk Export Import` | 30 |

Option A spends the 3 spare characters on "Bulk", a term merchants actually
search. Keep the brand prefix either way — names must be brand-led, and
Matrixify does the same.

⚠️ Changing the name may re-trigger review. Confirm the listing handle
(`apps.shopify.com/syncifypro`) is not derived from it before changing.

### App introduction — 100 char max

> Export any Shopify data to Excel or CSV, bulk-update it, and import it back in minutes.

Benefit-led with a time outcome, no keyword stuffing.

### App card subtitle

| | Value | Chars |
|---|---|---|
| Current | Bulk export, import, and migration for your store data | 54 |
| Proposed | Bulk export, import & update via Excel, CSV, FTP & Drive | 56 |

Essentially the same length, but trades the vague "for your store data" for the formats and
destinations merchants type into search. Matrixify's equivalent is
"Bulk import, export & update via Excel, CSV, MCP &…" — it truncates around 50
characters in the card, so keep the front-loaded words the important ones.

### Search terms — up to 5, complete words, one idea each

1. excel export
2. bulk import
3. csv export
4. metafields export
5. data migration

Deliberately *not* bare "export" or "import". The listing currently sits around
1,300th for `export` and 584th for `import`; those head terms are unwinnable
right now. These five are narrower, match what the app genuinely does best, and
face far less competition.

---

## Outside the three items — worth doing at the same time

**Add a secondary category: "Bulk editor."** The listing has only
`Store data importer`. The rules allow a secondary tag when the primary doesn't
fully describe the app, and "Bulk editor" is defined as *apps that update
multiple products at once* — which is exactly what the import path does.
Matrixify carries this same pair. This is probably the single highest-leverage
change on the page, because merchants browse categories as well as search.

**The pricing on the listing is stale.** It still advertises Basic / Pro $12 /
Max $40 / Enterprise $150, while `EVERYTHING_FREE = true` in
[billing.server.js:27](../app/billing.server.js:27) gives every shop everything
for nothing. A merchant who opens the plan page and picks "Pro" will still be
charged $12 for features they already have. The Managed Pricing plans in the
Partner Dashboard need changing, not just the code.
