/**
 * migrations/platforms.js
 *
 * Metadata for the source platforms shown on the Migrations page — the tabs,
 * their connection fields, and help text. Shared by the route (server) and the
 * page (client), so it holds NO secrets and NO logic. `implemented` gates which
 * ones can actually connect yet; the rest render as "coming soon".
 */

export const PLATFORMS = [
  {
    id: "woocommerce",
    label: "WooCommerce",
    implemented: true,
    help: "Generate a read-only API key in WooCommerce under Settings → Advanced → REST API.",
    fields: [
      { key: "siteUrl",        label: "Site URL",        placeholder: "https://example.com" },
      { key: "consumerKey",    label: "Consumer key",    placeholder: "ck_00000000000000000000000000000000" },
      { key: "consumerSecret", label: "Consumer secret", placeholder: "cs_00000000000000000000000000000000", secret: true },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts", "redirects"],
  },
  {
    id: "bigcommerce",
    label: "BigCommerce",
    implemented: true,
    // No one-line help — the steps say it all. BigCommerce offers three API
    // types on its settings page; step 1 names the only one that works here.
    help: "",
    guide: [
      "In BigCommerce go to Settings → API → Store-level API accounts (not Storefront or Account-level) → Create API account.",
      "Token type: V2/V3 API token. Scopes, all read-only: Products, Customers, Orders, Marketing (coupons), Information & Settings.",
      "Save — the Access token is shown once; paste it here. Client ID / Client secret aren’t needed.",
      "Store hash is the {store_hash} in the API path shown there, https://api.bigcommerce.com/stores/{store_hash}/v3/ — the same code as in store-{store_hash}.mybigcommerce.com.",
    ],
    fields: [
      { key: "storeHash",   label: "Store hash",   placeholder: "abc123" },
      { key: "accessToken", label: "Access token", placeholder: "••••••••••••", secret: true },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts"],
  },
  {
    id: "magento",
    label: "Magento",
    implemented: true,
    help: "",
    guide: [
      "In Magento admin go to System → Extensions → Integrations → Add New Integration. Name it (e.g. SyncifyPro) and enter your admin password.",
      "On the API tab set Resource Access to Custom and tick: Catalog (Products, Categories, Attributes), Sales → Operations → Orders, Customers, Marketing → Promotions (cart price rules).",
      "Save, then Activate → Allow. Copy the Access Token; the Consumer Key/Secret and Access Token Secret aren’t needed.",
      "Magento 2.4.4+ only: under Stores → Configuration → Services → OAuth → Consumer Settings set “Allow OAuth Access Tokens to be used as standalone Bearer tokens” to Yes — otherwise the token is rejected as invalid.",
      "Store URL is your storefront’s base URL, e.g. https://shop.example.com — we add /rest/V1. If your API needs a store code, include it: https://shop.example.com/rest/default.",
    ],
    fields: [
      { key: "baseUrl",     label: "Store URL",    placeholder: "https://example.com" },
      { key: "accessToken", label: "Access token", placeholder: "••••••••••••", secret: true },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts", "redirects"],
  },
  {
    id: "prestashop",
    label: "PrestaShop",
    implemented: true,
    help: "",
    guide: [
      "In PrestaShop go to Advanced Parameters → Webservice, set “Enable PrestaShop’s webservice” to Yes and save.",
      "Add a new webservice key (Generate), give it a description, and tick GET (View) on: products, categories, customers, addresses, orders, cart_rules.",
      "Save and copy the 32-character key; it’s the only credential PrestaShop uses.",
      "Shop URL is your store’s base URL, e.g. https://shop.example.com — we add /api ourselves.",
    ],
    fields: [
      { key: "baseUrl", label: "Shop URL", placeholder: "https://example.com" },
      { key: "apiKey",  label: "API key",  placeholder: "••••••••••••", secret: true },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts"],
  },
  {
    id: "opencart",
    label: "OpenCart",
    // OpenCart has no read API, so the merchant uploads our read-only bridge
    // file (generated with a per-shop token) to the store root — see
    // migrations/opencart.server.js. `bridge` switches the form to that flow.
    implemented: true,
    bridge: true,
    help: "",
    guide: [
      "Click Download bridge file — it is a small read-only PHP file with your private token built in.",
      "Upload syncifypro-bridge.php to your OpenCart root folder (the one with config.php) using FTP or your hosting file manager.",
      "Enter your store URL and click Connect. Delete the file from your server after the migration.",
    ],
    fields: [
      { key: "siteUrl",     label: "Store URL",    placeholder: "https://example.com" },
      { key: "bridgeToken", label: "Bridge token", placeholder: "Filled in when you download the bridge file" },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts"],
  },
  {
    id: "etsy",
    label: "Etsy",
    // Etsy’s API Terms (Aug 2026) prohibit apps that "migrate Etsy Members
    // from Etsy", so the OAuth connector (still in etsy.server.js) can’t be
    // offered self-serve. Merchants ask us instead and we handle it case by
    // case. `contact` renders a contact-us card in place of the connect UI.
    implemented: true,
    contact: true,
    help: "Etsy migrations are handled by our team. Tell us about your shop and what you’d like to move, and we’ll get back to you within one business day.",
    fields: [],
    entities: ["products", "collections", "orders"],
  },
];

// Labels name the source term AND what it becomes in Shopify where they
// differ, so a WooCommerce merchant looking for "Categories" finds them.
export const ENTITY_LABELS = {
  products: "Products", customers: "Customers", orders: "Orders",
  collections: "Categories → Collections", discounts: "Coupons → Discounts",
  redirects: "Redirects (generated)",
};

/**
 * Migration filters — limit which records the SOURCE platform sends back
 * (server-side, so only matching records are pulled). Each filter names the
 * entity it applies to and how it's entered: a multi-value list ("is any
 * of") or a single date. Mirrors Altera's WooCommerce filter set; the
 * connector maps them to the platform's own query params.
 */
export const MIGRATION_FILTERS = [
  { key: "product_status",   entity: "products",  label: "Product status is any of",     kind: "list",
    options: ["publish", "draft", "pending", "private"] },
  { key: "product_created_after",   entity: "products", label: "Product created on or after",  kind: "date" },
  { key: "product_created_before",  entity: "products", label: "Product created before",       kind: "date" },
  { key: "product_updated_after",   entity: "products", label: "Product updated on or after",  kind: "date" },
  { key: "product_updated_before",  entity: "products", label: "Product updated before",       kind: "date" },
  { key: "order_status",     entity: "orders",    label: "Order status is any of",       kind: "list",
    options: ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"] },
  { key: "order_created_after",     entity: "orders",   label: "Order created on or after",    kind: "date" },
  { key: "order_created_before",    entity: "orders",   label: "Order created before",         kind: "date" },
  { key: "order_updated_after",     entity: "orders",   label: "Order updated on or after",    kind: "date" },
  { key: "order_updated_before",    entity: "orders",   label: "Order updated before",         kind: "date" },
  { key: "customer_role",    entity: "customers", label: "Customer role is any of",      kind: "list",
    options: ["customer", "subscriber", "shop_manager", "administrator"] },
  { key: "customer_created_after",  entity: "customers", label: "Customer created on or after", kind: "date" },
  { key: "customer_created_before", entity: "customers", label: "Customer created before",      kind: "date" },
  { key: "customer_updated_after",  entity: "customers", label: "Customer updated on or after", kind: "date" },
  { key: "customer_updated_before", entity: "customers", label: "Customer updated before",      kind: "date" },
];

/**
 * Per-platform overrides for the list filters' option values (each platform
 * has its own status vocabulary) and which filters it can honour at all.
 * Platforms not listed get the WooCommerce defaults above.
 */
const PLATFORM_FILTER_OPTIONS = {
  woocommerce: {},
  magento: {
    product_status: ["enabled", "disabled"],
    order_status: ["pending", "pending_payment", "processing", "holded", "payment_review", "complete", "closed", "canceled", "fraud"],
    // Magento has customer groups, not roles — the role filter doesn't apply.
    customer_role: null,
  },
  bigcommerce: {
    product_status: ["visible", "hidden"],
    order_status: [
      "Pending", "Awaiting Payment", "Awaiting Fulfillment", "Awaiting Shipment", "Awaiting Pickup",
      "Partially Shipped", "Shipped", "Completed", "Cancelled", "Declined", "Refunded", "Partially Refunded",
      "Disputed", "Manual Verification Required", "Incomplete",
    ],
    customer_role: null, // customer groups, not roles
  },
  opencart: {
    product_status: ["enabled", "disabled"],
    order_status: [
      "Pending", "Processing", "Processed", "Shipped", "Complete", "Canceled", "Canceled Reversal", "Denied",
      "Expired", "Failed", "Refunded", "Reversed", "Chargeback", "Voided",
    ],
    customer_role: null,
  },
  prestashop: {
    product_status: ["active", "inactive"],
    order_status: [
      "Awaiting check payment", "Payment accepted", "Processing in progress", "Shipped", "Delivered", "Canceled",
      "Refunded", "Payment error", "On backorder (paid)", "Awaiting bank wire payment", "Remote payment accepted",
      "On backorder (not paid)", "Awaiting Cash On Delivery validation",
    ],
    customer_role: null,
  },
};

/** The filter definitions for one platform (options swapped, unsupported ones dropped). */
export function filtersFor(platformId) {
  const over = PLATFORM_FILTER_OPTIONS[platformId] ?? PLATFORM_FILTER_OPTIONS.woocommerce;
  return MIGRATION_FILTERS
    .filter((f) => over[f.key] !== null)
    .map((f) => (over[f.key] ? { ...f, options: over[f.key] } : f));
}

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}
