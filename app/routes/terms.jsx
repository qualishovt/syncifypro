/**
 * routes/terms.jsx — public Terms of Service at /terms.
 *
 * Unauthenticated, plain HTML (no App Bridge), like /privacy. Linked from the
 * App Store listing, OAuth consent screens (Google) and the app.
 */

export const meta = () => [
  { title: "Terms of Service — SyncifyPro" },
  { name: "description", content: "Terms for using the SyncifyPro Shopify app." },
  { name: "robots", content: "index,follow" },
];

const APP = "SyncifyPro";
const OPERATOR = "IntelliShop";
const CONTACT = "tehran.alishov@gmail.com";
const EFFECTIVE = "August 19, 2026";

/* eslint-disable react/no-unescaped-entities */
export default function Terms() {
  return (
    <main style={page}>
      <header style={header}>
        <div style={brand}>{APP}</div>
        <h1 style={h1}>Terms of Service</h1>
        <p style={muted}>Effective {EFFECTIVE}</p>
      </header>

      <p>
        These terms govern your use of {APP} ("the App"), a Shopify app operated by {OPERATOR} ("we", "us"). By
        installing or using the App you agree to them. If you use the App on behalf of a business, you confirm you
        are authorised to bind that business.
      </p>

      <h2 style={h2}>1. The service</h2>
      <p>
        The App lets Shopify merchants export, import, schedule and migrate store data (products, customers, orders,
        collections, discounts and related records) to and from spreadsheet files and connected destinations or
        sources (FTP/SFTP/S3 servers, Google Drive/Sheets, email, and other e-commerce platforms). Features may change
        over time; we will not remove core functionality without notice.
      </p>

      <h2 style={h2}>2. Your account and store</h2>
      <ul>
        <li>You must have a valid Shopify store and comply with Shopify's terms. The App operates within the permissions you grant it during installation.</li>
        <li>You are responsible for the data you export or import and for any changes the App makes to your store at your instruction — for example an import that updates or deletes products. Review the preview and keep backups (the App's export feature is suitable for that) before running destructive imports.</li>
        <li>Credentials you store in the App (server logins, API keys, OAuth connections) must be yours or used with the owner's permission.</li>
      </ul>

      <h2 style={h2}>3. Acceptable use</h2>
      <p>You agree not to use the App to infringe others' rights, to extract data you are not entitled to, to send unsolicited email, to circumvent Shopify or third-party platform limits, or to attempt to disrupt or reverse-engineer the service.</p>

      <h2 style={h2}>4. Data and privacy</h2>
      <p>
        How we handle data is described in our <a href="/privacy">Privacy Policy</a>, which forms part of these
        terms. In short: we process your store's data only on your instruction, act as your data processor, encrypt
        data in transit and at rest, and delete your data when you uninstall the App.
      </p>

      <h2 style={h2}>5. Third-party platforms</h2>
      <p>
        Migrations and deliveries rely on third-party services (Shopify, WooCommerce, BigCommerce, Magento, PrestaShop,
        Etsy, Google, email and storage providers). Their availability, limits and terms are outside our control, and
        you must comply with them when you connect them to the App.
      </p>

      <h2 style={h2}>6. Fees</h2>
      <p>
        Paid plans, trials and any usage limits are shown inside the App and billed through Shopify's billing system.
        Fees are non-refundable except where Shopify's policies or applicable law require otherwise. We may change
        prices with notice inside the App or by email; changes apply from your next billing cycle.
      </p>

      <h2 style={h2}>7. Availability and support</h2>
      <p>
        We aim for the App to be available at all times but do not guarantee uninterrupted service; maintenance,
        third-party outages and Shopify API limits can affect it. Support is provided by email at{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2 style={h2}>8. Warranties and liability</h2>
      <p>
        The App is provided "as is". To the extent permitted by law we disclaim implied warranties and are not liable
        for indirect or consequential losses, lost profits, or loss of data caused by imports you run, third-party
        services, or misuse of the App. Our total liability for any claim is limited to the fees you paid for the App
        in the 12 months before the claim. Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2 style={h2}>9. Termination</h2>
      <p>
        You can stop using the App at any time by uninstalling it from your store, which deletes your data as
        described in the Privacy Policy. We may suspend or terminate access for breach of these terms or where
        required by Shopify or law.
      </p>

      <h2 style={h2}>10. Changes to these terms</h2>
      <p>We may update these terms; the effective date will change and material changes will be announced inside the App. Continued use after a change means you accept the updated terms.</p>

      <h2 style={h2}>11. Contact</h2>
      <p>{OPERATOR} — <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>

      <footer style={footer}>
        <a href="/privacy">Privacy Policy</a> · <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
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
