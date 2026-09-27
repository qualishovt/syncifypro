/**
 * export/templates.js
 *
 * Built-in export configurations for the product feeds merchants are asked
 * for most often. They are read-only: a merchant applies one, adjusts it if
 * they like, and saves it as a preset of their own — the template itself is
 * never edited in place.
 *
 * All five ingest the SAME layout: the RSS/g: product feed Google Merchant
 * Center defined, which Meta, Pinterest, TikTok and Microsoft each accept for
 * their own catalogues. They differ in what they FILTER and what the file is
 * called, not in the dialect — so this list claims nothing our google_feed
 * format doesn't actually produce. Feeds with their own column spec (Idealo,
 * for instance) are deliberately absent rather than approximated.
 */

/** Every feed starts from active products; a draft product has no business in a catalogue. */
const activeProducts = (extra = {}) => [{
  entity: "products",
  filters: { status: "active", ...extra },
  // No column selection: the feed adapter decides its own fields, and
  // narrowing the export would only starve it of data.
  fields: undefined,
  advancedFilters: [],
  sort: undefined,
}];

export const EXPORT_TEMPLATES = [
  {
    id: "feed-google",
    name: "Google Shopping feed",
    description: "Active products as the RSS feed Google Merchant Center ingests.",
    format: "google_feed",
    specs: activeProducts(),
    options: { filename: "google-shopping-{date}" },
  },
  {
    id: "feed-meta",
    name: "Meta catalogue feed",
    description: "The same feed layout Meta accepts for Facebook and Instagram catalogues.",
    format: "google_feed",
    specs: activeProducts(),
    options: { filename: "meta-catalogue-{date}" },
  },
  {
    id: "feed-pinterest",
    name: "Pinterest catalogue feed",
    description: "Active products for Pinterest catalogues, in the feed layout it reads.",
    format: "google_feed",
    specs: activeProducts(),
    options: { filename: "pinterest-catalogue-{date}" },
  },
  {
    id: "feed-tiktok",
    name: "TikTok catalogue feed",
    description: "Active products for a TikTok Shop catalogue.",
    format: "google_feed",
    specs: activeProducts(),
    options: { filename: "tiktok-catalogue-{date}" },
  },
  {
    id: "feed-microsoft",
    name: "Microsoft Shopping feed",
    description: "Active products for Microsoft (Bing) Merchant Center.",
    format: "google_feed",
    specs: activeProducts(),
    options: { filename: "microsoft-shopping-{date}" },
  },
];

export const templateById = (id) => EXPORT_TEMPLATES.find((t) => t.id === id) ?? null;
