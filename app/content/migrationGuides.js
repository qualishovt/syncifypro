/**
 * content/migrationGuides.js — one page per source platform.
 *
 * The connection steps here must match app/migrations/platforms.js; if a guide
 * in the app changes, change it here too.
 */

export const MIGRATION_GUIDES = [
  {
    slug: "woocommerce",
    platform: "woocommerce",
    title: "Migrate WooCommerce to Shopify",
    summary: "Connect with a read-only REST API key and bring products, customers, orders, categories and coupons across.",
    entities: "Products, customers, orders, categories → collections, coupons → discounts, redirects",
    body: [
      ["h2", "Get your API keys"],
      ["steps", [
        "In WordPress, open WooCommerce → Settings → Advanced → REST API.",
        "Click Add key. Give it a description, choose your user, and set permissions to Read.",
        "Copy the Consumer key and Consumer secret — they are shown once.",
      ]],
      ["h2", "Connect"],
      ["p", "In SyncifyPro open Migrations → WooCommerce, paste your site URL, consumer key and secret, then click Connect. The app reads back a record count per data type so you can confirm it's looking at the right store."],
      ["h2", "What comes across"],
      ["ul", [
        "Products with variations, images, prices, stock and attributes",
        "Customers with billing and shipping addresses",
        "Orders with line items, totals and status",
        "Product categories, which become Shopify collections",
        "Coupons, which become discount codes",
      ]],
      ["h2", "Filters"],
      ["p", "WooCommerce migrations support the full filter set: product status, created/updated ranges, order status and customer role. Useful when the store carries years of test orders you have no intention of moving."],
      ["h2", "Redirects"],
      ["p", "WooCommerce URLs (/product/handle/, /product-category/slug/) don't match Shopify's. A Redirects sheet is generated with the mapping so your existing links keep working."],
      ["note", "If your site is behind Basic Auth, a firewall or a \"coming soon\" plugin, the API won't answer. Whitelist it before connecting."],
    ],
  },
  {
    slug: "bigcommerce",
    platform: "bigcommerce",
    title: "Migrate BigCommerce to Shopify",
    summary: "Use a Store-level API account — the only one of BigCommerce's three API types that works here.",
    entities: "Products, customers, orders, categories → collections, coupons → discounts",
    body: [
      ["note", "BigCommerce offers three API types. You need a Store-level API account, not an App or Account-level one."],
      ["h2", "Create the API account"],
      ["steps", [
        "In the BigCommerce control panel, go to Settings → API → Store-level API accounts.",
        "Click Create API account, name it, and set the OAuth scopes to read-only for Products, Customers, Orders, Marketing and Content.",
        "Save. A .txt file downloads containing the store hash and access token.",
      ]],
      ["h2", "Connect"],
      ["p", "Paste the store hash and access token into Migrations → BigCommerce. The store hash is the short code in your API path, not your storefront domain."],
      ["h2", "What comes across"],
      ["ul", ["Products with variants, images and stock", "Customers with addresses", "Orders with products and totals", "Categories → collections", "Coupons → discounts"]],
      ["h2", "Filters"],
      ["p", "Product visibility, order status and date ranges are supported; BigCommerce's order status vocabulary (Awaiting Fulfillment, Shipped, Completed and so on) is used as-is so the filter matches what you see in their admin."],
    ],
  },
  {
    slug: "magento",
    platform: "magento",
    title: "Migrate Magento 2 to Shopify",
    summary: "Create an integration, activate it, and connect with the access token.",
    entities: "Products, customers, orders, categories → collections, cart price rules → discounts, redirects",
    body: [
      ["h2", "Create an integration"],
      ["steps", [
        "In the Magento admin, go to System → Extensions → Integrations → Add New Integration.",
        "Name it, then under API set Resource Access to the catalog, customer and sales resources (read access is enough).",
        "Save, then click Activate → Allow on the integration row.",
        "Copy the Access Token from the tokens shown.",
      ]],
      ["h2", "Connect"],
      ["p", "Paste your store URL and the access token into Migrations → Magento. The URL is your storefront base — the app adds the REST path itself."],
      ["h2", "What comes across"],
      ["ul", [
        "Simple and configurable products; configurables become Shopify products with variants",
        "Stock from MSI source items",
        "Customers with addresses",
        "Orders with line items",
        "Categories → collections, cart price rules → discounts",
        "URL rewrites → redirects",
      ]],
      ["note", "Magento's REST API is slower than the others. A large catalog takes a while; the job runs in the background and you can leave the page."],
    ],
  },
  {
    slug: "prestashop",
    platform: "prestashop",
    title: "Migrate PrestaShop to Shopify",
    summary: "Enable the Webservice, create a read-only key, and connect with your shop URL.",
    entities: "Products, customers, orders, categories → collections, cart rules → discounts",
    body: [
      ["h2", "Enable the Webservice"],
      ["steps", [
        "In the PrestaShop admin, go to Advanced Parameters → Webservice.",
        "Set \"Enable PrestaShop's webservice\" to Yes and save.",
        "Click Add new webservice key, generate a key, and set permissions to View (GET) for products, combinations, customers, addresses, orders, order details, categories and cart rules.",
        "Save and copy the key.",
      ]],
      ["h2", "Connect"],
      ["p", "Enter your shop URL — just the domain, we append /api ourselves — and the key. If your shop is multi-language, values come across in the shop's default language."],
      ["h2", "What comes across"],
      ["ul", ["Products with combinations, prices and stock", "Customers with addresses", "Orders with order rows", "Categories (from level 2 down) → collections", "Cart rules → discounts"]],
      ["note", "PrestaShop returns 401 if the key lacks a resource. If a data type comes back empty, check that resource's permission first."],
    ],
  },
  {
    slug: "opencart",
    platform: "opencart",
    title: "Migrate OpenCart to Shopify",
    summary: "OpenCart has no read API, so a small read-only bridge file does the reading.",
    entities: "Products, customers, orders, categories → collections, coupons → discounts",
    body: [
      ["note", "OpenCart's built-in API only covers checkout — there is no endpoint that lists products, customers or orders. Every migration tool works around this the same way."],
      ["h2", "Install the bridge"],
      ["steps", [
        "In SyncifyPro open Migrations → OpenCart and click Download bridge file.",
        "Upload syncifypro-bridge.php into your OpenCart root folder — the one that contains config.php.",
        "Enter your store URL and click Connect.",
        "Delete the file from your server when the migration is finished.",
      ]],
      ["h2", "What the bridge does"],
      ["p", "It is read-only, refuses any request without your private token, and never writes to your database. It serves products (with options, images and specials), categories, customers, orders and coupons as JSON."],
      ["h2", "What comes across"],
      ["ul", [
        "Products with option combinations turned into Shopify variants",
        "Special prices, which become compare-at prices",
        "Customers with addresses",
        "Orders with line items and option choices",
        "Categories → collections, coupons → discounts",
      ]],
      ["note", "Tested against OpenCart 4.x. On OpenCart 3, get in touch before starting and we'll check your version."],
    ],
  },
];

export function getMigrationGuide(slug) {
  return MIGRATION_GUIDES.find((g) => g.slug === slug) ?? null;
}
