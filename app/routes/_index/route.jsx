/**
 * routes/_index — public landing page at / (served on syncifypro.app and
 * app.syncifypro.app). Doubles as the "home page" URL for Google OAuth
 * branding verification and the Shopify listing, so it must describe the
 * app and link privacy/terms. `?shop=` still deep-links into the admin app.
 */

import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";

export const meta = () => [
  { title: "SyncifyPro — Export, Import & Migrate your Shopify data" },
  // www + app subdomains serve this same page; the apex is the canonical home.
  { tagName: "link", rel: "canonical", href: "https://syncifypro.app/" },
  { name: "description", content: "SyncifyPro is a Shopify app for bulk exporting, importing, scheduling and migrating store data — products, customers, orders, collections and more." },
];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

const FEATURES = [
  ["Export everything", "32 data types — products, customers, orders, collections, discounts, metafields and more — to Excel or CSV, with filters and column control."],
  ["Import with confidence", "Preview every sheet before it runs, follow live progress, and download a results file that shows exactly what happened to each row."],
  ["Schedule it", "Repeat exports and imports hourly to monthly, delivered to email, FTP/SFTP, Amazon S3 or Google Drive/Sheets."],
  ["Migrate from anywhere", "Pull your catalog, customers and orders straight from WooCommerce, BigCommerce, Magento, PrestaShop or Etsy into an import-ready file."],
];

export default function Index() {
  const { showForm } = useLoaderData();
  return (
    <main style={page}>
      <header style={hero}>
        <div style={heroRow}>
          <img src="/brand/syncifypro-icon-rounded.svg" alt="SyncifyPro logo" width="72" height="72" style={{ display: "block", borderRadius: 16 }} />
          <div>
            <h1 style={h1}>SyncifyPro</h1>
            <p style={subtitle}>Shopify data export, import and migration</p>
          </div>
        </div>
        <p style={tagline}>
          SyncifyPro is a Shopify app that helps merchants export, import, update, schedule and migrate
          their store data.
        </p>
      </header>

      {/* Explicit purpose statement — Google branding verification requires the
          home page to name the app and state what it does in visible text. */}
      <section style={{ maxWidth: 720, margin: "0 0 2rem" }}>
        <h2 style={{ fontSize: 20, margin: "0 0 .4rem" }}>What is SyncifyPro?</h2>
        <p style={{ margin: 0, color: "#44474a" }}>
          SyncifyPro is an application for Shopify merchants. It exports store data (products, customers,
          orders, collections, discounts and more) to Excel/CSV files, imports and updates data from such
          files, runs these jobs on schedules, and migrates catalogs from WooCommerce, BigCommerce, Magento,
          PrestaShop and Etsy into Shopify. If you connect your Google account, SyncifyPro can deliver your
          export files to your Google Drive as spreadsheets — it only creates new files and never reads other
          files in your Drive.
        </p>
      </section>

      <section style={grid}>
        {FEATURES.map(([title, body]) => (
          <div key={title} style={card}>
            <h2 style={h2}>{title}</h2>
            <p style={cardBody}>{body}</p>
          </div>
        ))}
      </section>

      {showForm && (
        <section style={loginBox}>
          <p style={{ margin: "0 0 .6rem", fontWeight: 600 }}>Already installed? Open the app with your shop domain:</p>
          <Form method="post" action="/auth/login" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={input} type="text" name="shop" placeholder="my-shop.myshopify.com" aria-label="Shop domain" />
            <button style={button} type="submit">Log in</button>
          </Form>
        </section>
      )}

      <footer style={footer}>
        <span>© {new Date().getFullYear()} SyncifyPro · Operated by IntelliShop</span>
        <span style={{ display: "inline-flex", gap: 14 }}>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="mailto:tehran.alishov@gmail.com">Contact</a>
        </span>
      </footer>
    </main>
  );
}

const page = {
  maxWidth: 900, margin: "0 auto", padding: "4rem 1.5rem 3rem",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  color: "#202223", lineHeight: 1.6,
};
const hero = { textAlign: "left", marginBottom: "2.5rem" };
const heroRow = { display: "flex", alignItems: "center", gap: 18, marginBottom: ".75rem" };
const h1 = { fontSize: 40, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.1 };
const subtitle = { margin: ".25rem 0 0", fontSize: 16, fontWeight: 600, color: "#45795a" };
const tagline = { fontSize: 19, color: "#44474a", maxWidth: 640, margin: 0 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 };
const card = { border: "1px solid #e1e3e5", borderRadius: 12, padding: "1.1rem 1.25rem", background: "#fafbfb" };
const h2 = { fontSize: 17, margin: "0 0 .35rem" };
const cardBody = { margin: 0, fontSize: 14.5, color: "#44474a" };
const loginBox = { marginTop: "2.5rem", padding: "1.25rem", border: "1px solid #e1e3e5", borderRadius: 12 };
const input = { flex: "1 1 260px", padding: ".55rem .75rem", border: "1px solid #8a8f96", borderRadius: 8, fontSize: 15 };
const button = { padding: ".55rem 1.2rem", border: "none", borderRadius: 8, background: "#45795a", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const footer = {
  marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #e1e3e5",
  display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, color: "#6d7175", fontSize: 14,
};
