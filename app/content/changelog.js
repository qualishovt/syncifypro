/**
 * content/changelog.js — What's new.
 *
 * Only ship entries for things that are actually live. Grouped by month rather
 * than exact dates, because that's what we can state honestly.
 */

export const CHANGELOG = [
  {
    period: "August 2026",
    entries: [
      ["New", "OpenCart migrations. Connect an OpenCart store with a read-only bridge file and bring products, customers, orders, categories and coupons across."],
      ["New", "Live chat inside the app. The chat bubble carries your shop domain, so support can see which store is asking."],
      ["New", "Resources and Blog. Guides, tutorials, per-platform migration walkthroughs and write-ups, all on the site."],
      ["New", "Light and dark theme across the marketing site, following your device setting if you want it to."],
      ["Improved", "Migration filters. Product status, order status and created/updated date ranges now apply to every connected platform, using each platform's own vocabulary."],
      ["Improved", "Import previews now separate created, updated, skipped and deleted counts before you confirm a run."],
      ["Fixed", "Products with no options failed to import; they now fall back to a default variant."],
      ["Fixed", "Redirect rows whose path already existed failed instead of updating the existing redirect."],
    ],
  },
  {
    period: "July 2026",
    entries: [
      ["New", "Migrations. Pull a whole store from WooCommerce, BigCommerce, Magento or PrestaShop into an import file, with URL redirects generated so search rankings survive."],
      ["New", "Per-job pages. Every run has its own page with live progress, the source file, the results workbook and its history."],
      ["New", "Scheduling with five delivery destinations: email, FTP/SFTP, Amazon S3, Google Drive and Google Sheets."],
      ["Improved", "Import filters — mode, row filters and column selection — so an import can be narrowed the same way an export can."],
    ],
  },
  {
    period: "June 2026",
    entries: [
      ["New", "32 export data types, including metafields, metaobjects, translations, payouts, gift cards and menus."],
      ["New", "Export formats beyond spreadsheets: XML, JSON, PDF and a Google Shopping feed."],
      ["New", "Automatic bulk operations for large stores — exports above ten thousand products switch to Shopify's bulk API without you choosing anything."],
      ["Improved", "Sheet Permissions in Settings, to hide data types your team shouldn't touch."],
    ],
  },
];
