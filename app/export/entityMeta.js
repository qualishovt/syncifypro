/**
 * export/entityMeta.js
 *
 * The canonical entity list plus its display metadata (icons, labels),
 * shared by the export page's Data table and the import page's
 * "Import as" picker so both always show the same 32 entities.
 */

/** Every exportable entity, in the export page's order. */
export const ENTITIES = ["products", "orders", "customers", "collections", "smart_collections", "custom_collections", "discounts", "content", "articles", "draft_orders", "gift_cards", "redirects", "product_media", "inventory", "selling_plans", "metafields", "segments", "store_credit", "markets", "delivery_profiles", "shop", "files", "payouts", "menus", "companies", "locations", "catalogs", "inventory_transfers", "activity", "metaobjects", "definitions", "translations"];

/** Polaris s-icon type per entity. */
export const ENTITY_ICONS = {
  products: "product",
  orders: "order",
  customers: "person",
  collections: "collection",
  smart_collections: "collection",
  custom_collections: "collection",
  discounts: "discount",
  pages: "page",
  blogs: "blog",
  articles: "note",
  redirects: "link",
  shop: "store",
  files: "image",
  payouts: "bank",
  menus: "menu",
  companies: "store-managed",
  draft_orders: "order-draft",
  gift_cards: "gift-card",
  inventory: "inventory",
  selling_plans: "calendar",
  markets: "globe",
  delivery_profiles: "delivery",
  segments: "person-segment",
  subscriptions: "calendar-time",
  store_credit: "wallet",
  product_media: "image",
  activity: "clock",
  metaobjects: "database",
  metaobject_definitions: "database",
  metafields: "metafields",
  translations: "language-translate",
  locations: "location",
  catalogs: "collection-list",
  inventory_transfers: "transfer-in",
  content: "page",
  definitions: "data-table",
};

/** Title-case each underscore-separated word: "smart_collections" → "Smart Collections". */
export function capitalize(s) {
  return s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Display names that don't follow the default title-casing of the entity key.
export const ENTITY_LABEL_OVERRIDES = {
  definitions: "Metafield definitions",
  inventory_transfers: "Inventory transfers",
  smart_collections: "Smart collections",
  custom_collections: "Manual collections", // Shopify admin's name for custom collections
  articles: "Blog posts",
  gift_cards: "Gift cards",
  selling_plans: "Selling plans",
  delivery_profiles: "Shipping profiles",
  store_credit: "Store credit",
  product_media: "Product media",
  segments: "Customer segments",
  // Exports the full translatable-content template (every translatable field,
  // translated or not), so "Translatables" is more accurate than "Translations".
  translations: "Translatables",
};

/** Human label for an entity key — override first, else title-cased key. */
export function entityDisplayName(e) {
  return ENTITY_LABEL_OVERRIDES[e] ?? capitalize(e);
}
