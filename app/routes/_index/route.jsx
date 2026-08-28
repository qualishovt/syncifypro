/**
 * routes/_index — syncifypro.app homepage.
 *
 * app.* host → install-only card (App Store link, req 2.3.1).
 * Any other host → the marketing page (app/routes/_index/marketing.jsx,
 * promoted from /new on 2026-08-28).
 */

import { redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import CrispChat from "../../components/CrispChat.jsx";
import NewMarketing from "./marketing.jsx";

export const meta = ({ data }) =>
  data?.installOnly
    ? [{ title: "SyncifyPro — Install" }, { name: "robots", content: "noindex" }]
    : [
        { title: "SyncifyPro: Shopify Data Bulk Export, Import, Update & Migrate" },
        {
          name: "description",
          content:
            "SyncifyPro is a Shopify app that helps merchants export, import, update, schedule and migrate their store data — products, customers, orders, collections and more — with Excel and CSV files.",
        },
        { tagName: "link", rel: "canonical", href: "https://syncifypro.app/" },
      ];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  // The app.* subdomain is the install entry point; everything else markets.
  const host = (request.headers.get("host") || url.host || "").toLowerCase();
  return {
    showForm: Boolean(login),
    installOnly: host.startsWith("app."),
    // Live-chat widget id (Crisp). Unset locally → no bubble.
    // eslint-disable-next-line no-undef
    crispWebsiteId: process.env.CRISP_WEBSITE_ID || "",
  };
};

export default function Index() {
  const { installOnly, crispWebsiteId } = useLoaderData();
  return (
    <>
      {installOnly ? <InstallPage /> : <NewMarketing />}
      <CrispChat websiteId={crispWebsiteId} />
    </>
  );
}

/* ─────────────────────────── install / login card ─────────────────────────── */

/* eslint-disable react/prop-types */
function InstallPage() {
  return (
    <main style={inst.page}>
      <div style={inst.card}>
        <div style={inst.brandRow}>
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="32" height="32" style={inst.brandIcon} />
          <h1 style={inst.title}>SyncifyPro: Bulk Export, Import, Schedule &amp; Migrate</h1>
        </div>
        {/* Installs must start on a Shopify surface (App Store req. 2.3.1), so we
            link to the listing instead of asking for a myshopify.com domain.
            Installed merchants reach the app from their admin, not this card. */}
        <p style={inst.label}>Install SyncifyPro from the Shopify App Store, then open it from your Shopify admin.</p>
        <a style={{ ...inst.button, display: "inline-block", textDecoration: "none", textAlign: "center" }} href="https://apps.shopify.com/syncifypro">
          View on the Shopify App Store
        </a>
      </div>
      <p style={inst.foot}>
        <a style={inst.footLink} href="https://syncifypro.app/">syncifypro.app</a>
        <span aria-hidden="true"> · </span>
        <a style={inst.footLink} href="/privacy">Privacy</a>
        <span aria-hidden="true"> · </span>
        <a style={inst.footLink} href="/terms">Terms</a>
      </p>
    </main>
  );
}


/* eslint-enable react/prop-types */

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const GREEN = "#2e7d4f";

const inst = {
  page: {
    minHeight: "100vh", background: "#f6f6f7", fontFamily: SANS, color: "#202223",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem 1rem",
  },
  card: {
    width: "100%", maxWidth: 545, background: "#fff", border: "1px solid #e1e3e5",
    borderRadius: 12, padding: "1.25rem 1.25rem 1.5rem", boxShadow: "0 1px 2px rgba(0,0,0,.05)",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: ".9rem" },
  brandIcon: { display: "block", borderRadius: 8 },
  title: { fontSize: 15, fontWeight: 650, margin: 0, lineHeight: 1.35 },
  form: { display: "flex", flexDirection: "column", gap: ".5rem" },
  label: { fontSize: 14, color: "#42474c", margin: 0 },
  input: {
    width: "100%", boxSizing: "border-box", padding: ".5rem .75rem", fontSize: 14,
    border: "1px solid #8a8f96", borderRadius: 8, background: "#fff", color: "#202223",
  },
  button: {
    alignSelf: "flex-end", marginTop: ".35rem", padding: ".55rem 1rem", fontSize: 14, fontWeight: 600,
    color: "#fff", background: GREEN, border: "none", borderRadius: 8, cursor: "pointer",
  },
  foot: { marginTop: "1rem", fontSize: 13, color: "#6d7175" },
  footLink: { color: "#6d7175" },
};
