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
    entities: ["products", "customers", "orders", "collections", "discounts"],
  },
  {
    id: "bigcommerce",
    label: "BigCommerce",
    implemented: true,
    help: "Create a store-level API account in BigCommerce under Settings → API accounts (Products, Orders, Customers, Marketing → read-only).",
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
    help: "Create an integration in Magento under System → Integrations (grant Catalog, Sales, Customers, Marketing) and use its access token.",
    fields: [
      { key: "baseUrl",     label: "Store URL",    placeholder: "https://example.com" },
      { key: "accessToken", label: "Access token", placeholder: "••••••••••••", secret: true },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts"],
  },
  {
    id: "prestashop",
    label: "PrestaShop",
    implemented: true,
    help: "Enable the Webservice and create an API key in PrestaShop under Advanced Parameters → Webservice (grant the resources you want to migrate).",
    fields: [
      { key: "baseUrl", label: "Shop URL", placeholder: "https://example.com" },
      { key: "apiKey",  label: "API key",  placeholder: "••••••••••••", secret: true },
    ],
    entities: ["products", "customers", "orders", "collections", "discounts"],
  },
  {
    id: "etsy",
    label: "Etsy",
    implemented: true,
    oauth: true,
    help: "Create an app at developers.etsy.com, add the callback URL below as a redirect URI, then paste its keystring (API key) and connect.",
    fields: [
      { key: "keystring", label: "Etsy app keystring (API key)", placeholder: "abcdefghijklmnopqrstuvwx" },
    ],
    entities: ["products", "collections", "orders"],
  },
];

export const ENTITY_LABELS = {
  products: "Products", customers: "Customers", orders: "Orders",
  collections: "Collections", discounts: "Discounts",
};

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}
