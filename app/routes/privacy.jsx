/**
 * routes/privacy.jsx — public Privacy Policy at /privacy.
 *
 * Unauthenticated, no App Bridge: linked from the Shopify App Store listing,
 * the Partners "protected customer data" form, and the app itself. Plain
 * server-rendered HTML so it works outside the Shopify admin.
 */

export const meta = () => [
  { title: "Privacy Policy — SyncifyPro" },
  { name: "description", content: "How SyncifyPro handles merchant and customer data." },
  { name: "robots", content: "index,follow" },
];

const APP = "SyncifyPro";
const OPERATOR = "IntelliShop";
const CONTACT = "support@syncifypro.app";
const APP_URL = "https://app.syncifypro.app";
const EFFECTIVE = "August 19, 2026";

/* eslint-disable react/no-unescaped-entities */
export default function Privacy() {
  return (
    <main style={page}>
      <header style={header}>
        <div style={brand}>{APP}</div>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={muted}>Effective {EFFECTIVE}</p>
      </header>

      <p>
        {APP} ("the App", "we", "us") is a Shopify app operated by {OPERATOR} that lets merchants export, import,
        schedule and migrate their store data. This policy explains what data the App processes, why, how it is
        protected, and the choices merchants and their customers have. By installing the App you agree to this policy.
      </p>

      <h2 style={h2}>1. Who we are and how to reach us</h2>
      <p>
        {OPERATOR} — contact <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We act as a <strong>data processor</strong> on
        behalf of the merchant, who remains the data controller for their store's data.
      </p>

      <h2 style={h2}>2. Data we process</h2>
      <p>The App only processes data when a merchant runs (or schedules) an export, import or migration, and only for the entities and columns the merchant selects. Depending on that selection this can include:</p>
      <ul>
        <li><strong>Store data</strong>: products, variants, collections, inventory, discounts, metafields, pages, blogs, redirects, files, markets and similar catalog/content records.</li>
        <li><strong>Customer personal data</strong> (Shopify "protected customer data"): customer name, email address, phone number and addresses, and the same fields as they appear on orders, draft orders and gift cards.</li>
        <li><strong>Order data</strong>: order line items, totals, payment and fulfillment status, shipping/billing details.</li>
        <li><strong>Merchant account data</strong>: the shop domain, the Shopify access token required to call the Admin API, app settings, presets, schedules and job history.</li>
        <li><strong>Credentials the merchant chooses to store</strong> for delivery destinations and migration sources (FTP/SFTP/S3 servers, Google Drive/Sheets connection, WooCommerce/BigCommerce/Magento/PrestaShop/Etsy API keys). These are encrypted (AES-256-GCM) before storage and never returned to the browser.</li>
      </ul>
      <p>We do not collect data directly from the merchant's customers, and we do not use tracking pixels, advertising identifiers or analytics on customer data.</p>

      <h2 style={h2}>3. Purposes</h2>
      <p>Personal data is used solely for <strong>store management</strong> on the merchant's instruction:</p>
      <ul>
        <li>producing the export/import/migration files the merchant requested;</li>
        <li>matching and updating records during imports (for example by email or handle);</li>
        <li>delivering files to the destinations the merchant configured (download, their own FTP/SFTP/S3 server, Google Drive/Sheets, or email recipients they specify);</li>
        <li>showing job history and results inside the App.</li>
      </ul>
      <p>We never sell personal data, use it for advertising, profiling or automated decision-making, or share it with anyone other than the sub-processors listed below.</p>

      <h2 style={h2}>4. Where data is stored and for how long</h2>
      <ul>
        <li><strong>Export/import files</strong> are stored on Cloudflare R2 (encrypted at rest) and shared via short-lived signed links. Files are deleted according to the retention period configured in the App's Settings, or when the merchant deletes a job.</li>
        <li><strong>Job records, settings, presets, schedules and encrypted credentials</strong> are stored in the App's database hosted on Fly.io (Amsterdam, EU), encrypted at rest and backed up with encrypted snapshots.</li>
        <li><strong>On uninstall</strong>, Shopify notifies the App and all data for that shop (session, jobs, files, credentials, schedules) is deleted.</li>
      </ul>
      <p>Test/development data is kept in a separate environment from production data.</p>

      <h2 style={h2}>5. Sub-processors</h2>
      <p>We use these infrastructure providers, each bound by their own data-protection terms:</p>
      <ul>
        <li><strong>Fly.io</strong> — application hosting and database (EU region).</li>
        <li><strong>Cloudflare</strong> — R2 object storage for export/import files, DNS.</li>
        <li><strong>Resend</strong> — email delivery, only when a merchant chooses email as a delivery destination.</li>
        <li><strong>Google</strong> — Google Drive/Sheets, only when a merchant connects their Google account.</li>
        <li>Any FTP/SFTP/S3 server, marketplace or e-commerce platform the merchant connects is chosen and controlled by the merchant.</li>
      </ul>

      <h2 style={h2}>6. Security</h2>
      <ul>
        <li>All traffic uses TLS (HTTPS, SFTP/FTPS, HTTPS APIs).</li>
        <li>Data is encrypted at rest; merchant-entered credentials are additionally encrypted with AES-256-GCM using a key held only on the production server.</li>
        <li>Access to production systems is limited to the operator, protected by strong passwords and two-factor authentication.</li>
        <li>Every export/import run is logged in the App's job history; infrastructure access is logged by our providers.</li>
        <li>In the event of a security incident affecting personal data, we will contain it, notify affected merchants and Shopify without undue delay, and rotate credentials.</li>
      </ul>

      <h2 style={h2}>7. Merchant and customer rights</h2>
      <p>
        Merchants can view and delete job history and files inside the App at any time, and can uninstall the App to
        delete all of their data. Merchants receiving access, correction or deletion requests from their customers can
        fulfil them from Shopify; where the App still holds a related file, email us and we will delete it within 30 days.
        The App honours Shopify's mandatory <code>customers/data_request</code>, <code>customers/redact</code> and{" "}
        <code>shop/redact</code> webhooks.
      </p>

      <h2 style={h2}>8. Changes</h2>
      <p>We may update this policy; the effective date at the top will change and material changes will be announced inside the App.</p>

      <footer style={footer}>
        <a href={APP_URL}>{APP_URL}</a> · <a href="/terms">Terms of Service</a> · <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </footer>
    </main>
  );
}
/* eslint-enable react/no-unescaped-entities */

const page = {
  maxWidth: 780, margin: "0 auto", padding: "3rem 1.5rem 4rem",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontSize: 16, lineHeight: 1.6, color: "#202223",
};
const header = { marginBottom: "2rem" };
const brand = { fontWeight: 700, letterSpacing: ".04em", color: "#008060", textTransform: "uppercase", fontSize: 13 };
const h1 = { fontSize: 32, margin: ".25rem 0 .25rem" };
const h2 = { fontSize: 20, marginTop: "2rem" };
const muted = { color: "#6d7175", margin: 0 };
const footer = { marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #e1e3e5", color: "#6d7175", fontSize: 14 };
