/**
 * routes/_index — the public root, served on every hostname that points at the
 * app. Two faces, chosen by host:
 *
 *   app.syncifypro.app  →  a minimal install/login card (the standard Shopify
 *                          app entry point: enter shop domain → install).
 *   syncifypro.app      →  the marketing site (what merchants, Google's OAuth
 *                          branding review and the App Store listing see).
 *
 * `?shop=` on either host still deep-links straight into the embedded admin app.
 */

import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import PlatformLogo from "../../components/PlatformLogos.jsx";
import CrispChat from "../../components/CrispChat.jsx";

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
  const { showForm, installOnly, crispWebsiteId } = useLoaderData();
  return (
    <>
      {installOnly ? <InstallPage showForm={showForm} /> : <MarketingPage showForm={showForm} />}
      <CrispChat websiteId={crispWebsiteId} />
    </>
  );
}

/* ─────────────────────────── install / login card ─────────────────────────── */

/* eslint-disable react/prop-types */
function InstallPage({ showForm }) {
  return (
    <main style={inst.page}>
      <div style={inst.card}>
        <div style={inst.brandRow}>
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="32" height="32" style={inst.brandIcon} />
          <h1 style={inst.title}>SyncifyPro: Bulk Export, Import, Schedule &amp; Migrate</h1>
        </div>
        {showForm ? (
          <Form method="post" action="/auth/login" style={inst.form}>
            <label style={inst.label} htmlFor="shop">Enter your shop domain to log in or install this app.</label>
            <input id="shop" style={inst.input} type="text" name="shop" placeholder="example.myshopify.com" autoComplete="off" />
            <button style={inst.button} type="submit">Install app</button>
          </Form>
        ) : (
          <p style={inst.label}>Open this app from your Shopify admin.</p>
        )}
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

/* ────────────────────────────── marketing site ────────────────────────────── */

const NAV = [
  ["How it works", "#how"],
  ["Data types", "#data"],
  ["Migrate", "#migrate"],
  ["Security", "#security"],
];

/* Simple inline glyphs for the data-type grid — no icon dependency. */
const GLYPH = {
  tag: "M3 3h7l11 11-7 7L3 10V3Zm3.5 3.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  person: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5Z",
  doc: "M6 2h8l6 6v14H6V2Zm8 1.5V9h5.5L14 3.5ZM8 12h8v2H8v-2Zm0 4h8v2H8v-2Z",
  cart: "M3 4h3l3 11h9l3-8H8M9 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  box: "M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.3 6.2 3.1L12 10.5 5.8 7.4 12 4.3Z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1.5-1.5",
  grid: "M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.7 0 3.4 3 3.4 8s-1.7 8-3.4 8-3.4-3-3.4-8S10.3 4 12 4ZM3 12h18",
};

const DATA_TYPES = [
  ["Products", "box"], ["Smart Collections", "grid"], ["Custom Collections", "grid"],
  ["Customers", "person"], ["Companies", "person"], ["Discounts", "tag"],
  ["Draft Orders", "cart"], ["Orders", "cart"], ["Payouts", "doc"],
  ["Pages & Blog Posts", "doc"], ["Redirects", "link"], ["Files & Media", "doc"],
  ["Inventory", "box"], ["Gift Cards", "tag"], ["Menus", "grid"],
  ["Metaobjects", "grid"], ["Metafields", "grid"], ["Markets & Translations", "globe"],
];

const FEATURES = [
  {
    title: "Bulk export and import with Excel, CSV or Google Sheets",
    body: "Every sheet is human-readable and round-trips: export it, edit in a spreadsheet you already know, import it straight back. Filters and column control keep files exactly as big as you need.",
    art: "sheet",
  },
  {
    title: "Update your existing store data in bulk",
    body: "Whether you have 300 items or 300 thousand, update only the columns you care about — no need to re-import everything. Preview every run before it writes, and delete in bulk when you have to.",
    art: "update",
  },
  {
    title: "Schedule it once, then forget it",
    body: "Repeat exports and imports from hourly to monthly, delivered to email, FTP/SFTP, Amazon S3, or Google Drive and Sheets. Every run keeps its own history, results file and progress.",
    art: "clock",
  },
  {
    title: "Migrate another store into Shopify",
    body: "Pull products, customers, orders, categories and coupons out of WooCommerce, BigCommerce, Magento, PrestaShop, OpenCart or Etsy — with URL redirects generated so your SEO survives the move.",
    art: "migrate",
  },
];

const SECURITY = [
  ["Nothing is written until you approve it", "Imports show a full preview — records, rows and what will be created, updated or skipped — before a single change reaches your store."],
  ["Encrypted end to end", "TLS in transit, encrypted storage at rest, and server credentials sealed with AES-256-GCM that never travel back to your browser."],
  ["Deleted when you say so", "Files expire on the retention you set, any job can be erased, and uninstalling the app removes everything for your shop."],
  ["Shopify's data rules, followed", "Protected customer data handled per Shopify's requirements, with the mandatory privacy webhooks implemented."],
];

const SOURCES = [
  ["woocommerce", "WooCommerce"],
  ["bigcommerce", "BigCommerce"],
  ["magento", "Magento"],
  ["prestashop", "PrestaShop"],
  ["opencart", "OpenCart"],
  ["etsy", "Etsy"],
];

const FORMATS = ["Excel (.xlsx)", "CSV", "Google Sheets", "FTP / SFTP", "Amazon S3", "Google Drive", "Email"];

function MarketingPage({ showForm }) {
  return (
    <div style={mk.root}>
      <style dangerouslySetInnerHTML={{ __html: RESPONSIVE_CSS }} />
      <header style={mk.header} className="mk-header">
        <a href="/" style={mk.brandLink} className="mk-brand">
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="34" height="34" style={mk.logoImg} />
          <span style={mk.brandName}>SyncifyPro</span>
        </a>
        <nav style={mk.nav} className="mk-nav">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} style={mk.navLink}>{label}</a>
          ))}
        </nav>
        <a href="#install" style={mk.installBtn} className="mk-install-top">Install</a>
      </header>

      <main>
        {/* hero */}
        <section style={mk.hero} className="mk-hero">
          <div style={mk.heroText} className="mk-hero-text">
            <p style={mk.heroKicker}>Shopify App</p>
            <h1 style={mk.h1}>SyncifyPro: Shopify Data Bulk Export, Import, Update &amp; Migrate</h1>
            <p style={mk.heroSub} className="mk-hero-sub">
              Manage your Shopify store data by bulk exporting and importing human-readable Excel and
              CSV files — and migrate a whole store from another platform.
            </p>
            <a href="#install" style={mk.installBtnLg} className="mk-install-hero">Install</a>
          </div>
          <div style={mk.heroArt}>
            <AppMock />
          </div>
        </section>

        {/* format strip */}
        <section style={mk.strip}>
          {FORMATS.map((f) => (<span key={f} style={mk.stripItem}>{f}</span>))}
        </section>

        {/* data types */}
        <section id="data" style={mk.shaded}>
          <div style={mk.dataWrap} className="mk-datawrap">
            <h2 style={mk.h2}>Bulk Export and Import Shopify Data</h2>
            <div style={mk.dataGrid}>
              {DATA_TYPES.map(([label, glyph]) => (
                <div key={label} style={mk.dataItem}>
                  <span style={mk.dataIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={GLYPH[glyph]} />
                    </svg>
                  </span>
                  <span style={mk.dataLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <p style={mk.dataFoot}>32 data types in total — including inventory, selling plans, segments, store credit, locations, catalogs and transfers.</p>
        </section>

        {/* alternating features */}
        <section id="how" style={mk.features}>
          {FEATURES.map((f, i) => (
            <div key={f.title} style={{ ...mk.featureRow, flexDirection: i % 2 ? "row-reverse" : "row" }} className="mk-feature">
              <div style={mk.featureArt}><FeatureArt kind={f.art} /></div>
              <div style={{ ...mk.featureText, textAlign: i % 2 ? "right" : "left" }} className="mk-feature-text">
                <h3 style={mk.h3}>{f.title}</h3>
                <p style={mk.featureBody}>{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        {/* migrate */}
        <section id="migrate" style={mk.shaded}>
          <div style={mk.center}>
            <h2 style={mk.h2}>Migrate to Shopify</h2>
            <p style={mk.centerSub}>
              Connect your old store with read-only API keys. SyncifyPro pulls the data into a
              spreadsheet you can see and adjust — then imports it into Shopify when you are ready.
            </p>
            <div style={mk.sourceRow}>
              {SOURCES.map(([id, label]) => (
                <div key={id} style={mk.source}>
                  <PlatformLogo id={id} size={30} />
                  <span style={mk.sourceName}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* security */}
        <section id="security" style={mk.section}>
          <div style={mk.center}>
            <h2 style={mk.h2}>Your data, handled carefully</h2>
          </div>
          <div style={mk.secGrid}>
            {SECURITY.map(([title, body]) => (
              <article key={title} style={mk.secCard}>
                <h3 style={mk.secTitle}>{title}</h3>
                <p style={mk.secBody}>{body}</p>
              </article>
            ))}
          </div>
          <p style={mk.secFoot}>
            Read our <a href="/privacy" style={mk.link}>privacy policy</a> and{" "}
            <a href="/terms" style={mk.link}>terms of service</a>.
          </p>
        </section>

        {/* final CTA */}
        <section id="install" style={mk.cta}>
          <h2 style={mk.ctaTitle}>Start managing your Shopify data today!</h2>
          {showForm && (
            <Form method="post" action="/auth/login" style={mk.ctaForm}>
              <input style={mk.ctaInput} type="text" name="shop" placeholder="example.myshopify.com" aria-label="Shop domain" autoComplete="off" />
              <button style={mk.installBtnLg} type="submit">Install</button>
            </Form>
          )}
        </section>
      </main>

      <footer style={mk.footer}>
        <div style={mk.footerCols}>
          <div>
            <p style={mk.footerHead}>Product</p>
            <a href="#how" style={mk.footerLink}>How it works</a>
            <a href="#data" style={mk.footerLink}>Data types</a>
            <a href="#migrate" style={mk.footerLink}>Migrate to Shopify</a>
          </div>
          <div>
            <p style={mk.footerHead}>Company</p>
            <a href="mailto:support@syncifypro.app" style={mk.footerLink}>Contact us</a>
            <a href="/privacy" style={mk.footerLink}>Privacy Policy</a>
            <a href="/terms" style={mk.footerLink}>Terms of Service</a>
          </div>
          <div>
            <p style={mk.footerHead}>Get started</p>
            <a href="#install" style={mk.footerLink}>Install the app</a>
            <a href="https://app.syncifypro.app/" style={mk.footerLink}>Log in</a>
          </div>
        </div>
        <div style={mk.footerBar}>
          <span style={mk.footerBrand}>
            <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="22" height="22" style={mk.footerIcon} />
            SyncifyPro
          </span>
          <span>© {new Date().getFullYear()} SyncifyPro · Operated by IntelliShop</span>
        </div>
      </footer>
    </div>
  );
}

/** A stylised screenshot of a running import — the hero's right-hand art. */
function AppMock() {
  const sheets = [
    ["Products", "New: 6", "Updated: 4", "Total: 10"],
    ["Custom Collections", "New: 2", "Updated: 1", "Total: 3"],
    ["Customers", "Updated: 1", null, "Total: 1"],
    ["Orders", "New: 1", null, "Total: 1"],
  ];
  return (
    <div style={mock.window} className="mk-mock">
      <div style={mock.side} className="mk-mock-side">
        {["Home", "Export", "Import", "Schedules", "Migrations", "Activity"].map((s, i) => (
          <span key={s} style={{ ...mock.sideItem, ...(i === 2 ? mock.sideItemActive : null) }}>{s}</span>
        ))}
      </div>
      <div style={mock.main}>
        <div style={mock.crumb}>SyncifyPro / Import: #10024</div>
        <div style={mock.badges}>
          <span style={mock.badgeGreen}>In progress</span>
          <span style={mock.badge}>Format: Excel</span>
          <span style={mock.badge}>Started: 09:12</span>
        </div>
        <div style={mock.progressTrack}><div style={mock.progressFill} /></div>
        <p style={mock.sheetsLabel}>Sheets</p>
        {sheets.map(([name, a, b, total]) => (
          <div key={name} style={mock.sheetRow} className="mk-sheetrow">
            <span style={mock.sheetName}>{name}</span>
            <span style={mock.sheetTags} className="mk-sheettags">
              {a && <span style={mock.tagNew}>{a}</span>}
              {b && <span style={mock.tagUpd}>{b}</span>}
              <span style={mock.tagTotal}>{total}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Light abstract art for the alternating feature rows. */
function FeatureArt({ kind }) {
  const G = "#45795a";
  const L = "#cfe3d7";
  if (kind === "sheet") {
    return (
      <svg viewBox="0 0 320 200" width="100%" role="img" aria-label="">
        <rect x="18" y="20" width="200" height="150" rx="12" fill="#fff" stroke={L} strokeWidth="2" />
        <rect x="18" y="20" width="200" height="26" rx="12" fill={G} opacity=".18" />
        {[70, 96, 122, 148].map((y) => (<rect key={y} x="34" y={y} width="168" height="8" rx="4" fill={L} />))}
        <rect x="120" y="60" width="182" height="120" rx="12" fill="#fff" stroke={G} strokeWidth="2" />
        <rect x="120" y="60" width="182" height="24" rx="12" fill={G} />
        {[104, 128, 152].map((y) => (<rect key={y} x="136" y={y} width="150" height="8" rx="4" fill={L} />))}
      </svg>
    );
  }
  if (kind === "update") {
    return (
      <svg viewBox="0 0 320 200" width="100%" role="img" aria-label="">
        {[30, 76, 122].map((y, i) => (
          <g key={y}>
            <rect x="24" y={y} width="150" height="34" rx="10" fill="#fff" stroke={L} strokeWidth="2" />
            <rect x="40" y={y + 13} width={90 - i * 18} height="8" rx="4" fill={L} />
            <rect x="196" y={y} width="100" height="34" rx="10" fill={i === 1 ? G : "#fff"} stroke={i === 1 ? G : L} strokeWidth="2" />
            <rect x="212" y={y + 13} width="64" height="8" rx="4" fill={i === 1 ? "#fff" : L} />
          </g>
        ))}
        <path d="M178 47h14M178 93h14M178 139h14" stroke={G} strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "clock") {
    return (
      <svg viewBox="0 0 320 200" width="100%" role="img" aria-label="">
        <rect x="26" y="30" width="150" height="140" rx="14" fill="#fff" stroke={L} strokeWidth="2" />
        <rect x="26" y="30" width="150" height="30" rx="14" fill={G} opacity=".18" />
        {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (
          <rect key={`${r}-${c}`} x={44 + c * 32} y={76 + r * 22} width="18" height="12" rx="4" fill={r === 1 && c === 2 ? G : L} />
        )))}
        <circle cx="238" cy="100" r="52" fill="#fff" stroke={G} strokeWidth="3" />
        <path d="M238 68v32l22 14" stroke={G} strokeWidth="4" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 200" width="100%" role="img" aria-label="">
      <circle cx="70" cy="60" r="24" fill="#fff" stroke={L} strokeWidth="2" />
      <circle cx="62" cy="132" r="24" fill="#fff" stroke={L} strokeWidth="2" />
      <circle cx="140" cy="96" r="24" fill="#fff" stroke={L} strokeWidth="2" />
      <rect x="212" y="52" width="88" height="88" rx="22" fill={G} />
      <path d="M242 116V80m0 0-12 12m12-12 12 12" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M270 76v36m0 0 12-12m-12 12-12-12" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M94 66h24M86 126h30M164 96h32" stroke={G} strokeWidth="3" strokeLinecap="round" strokeDasharray="4 6" />
    </svg>
  );
}
/* eslint-enable react/prop-types */

/* ─────────────────────────────────── styles ────────────────────────────────── */

/* The marketing page is built from inline style objects, which can't hold media
   queries. This stylesheet layers the mobile overrides on top via class hooks;
   `!important` is required to win over the inline (desktop) styles. */
const RESPONSIVE_CSS = `
@media (max-width: 900px) {
  .mk-hero {
    grid-template-columns: 1fr !important;
    padding: 2.5rem 1.25rem !important;
    gap: 1.75rem !important;
    text-align: center;
  }
  .mk-hero-text { max-width: 100% !important; margin: 0 auto; }
  .mk-hero-sub { max-width: 100% !important; margin-left: auto !important; margin-right: auto !important; }
  .mk-datawrap { grid-template-columns: 1fr !important; gap: 1.75rem !important; }
  .mk-feature { flex-direction: column !important; gap: 1.75rem !important; padding: 2.25rem 0 !important; }
  .mk-feature-text { text-align: center !important; }
}
@media (max-width: 767px) {
  .mk-header { gap: .5rem !important; }
  .mk-brand { padding-left: 1.25rem !important; }
  .mk-nav { display: none !important; }
  .mk-install-top { margin-right: 1.25rem !important; padding: .55rem 1.2rem !important; }
  .mk-install-hero { display: none !important; }   /* header button is enough on phones */
  /* the fixed 168px sidebar leaves no room for the sheet rows on phones */
  .mk-mock-side { display: none !important; }
  /* name on its own line, pills underneath */
  .mk-sheetrow { flex-direction: column !important; align-items: flex-start !important; gap: .4rem !important; }
  .mk-sheettags { justify-content: flex-start !important; }
}
`;

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const GREEN = "#45795a";
const GREEN_DARK = "#38634a";
const INK = "#16302a";
const BODY = "#5c6b63";
const LINE = "#e3ebe6";
const SHADE = "#f5f8f6";

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

const mk = {
  root: { background: "#fff", color: BODY, fontFamily: SANS, lineHeight: 1.65, overflowX: "hidden" },

  header: {
    display: "flex", alignItems: "center", gap: "1.5rem", borderBottom: `1px solid ${LINE}`,
    position: "sticky", top: 0, background: "#fff", zIndex: 10,
  },
  brandLink: {
    display: "inline-flex", alignItems: "center", gap: 10, flex: "none",
    textDecoration: "none", padding: "1rem 0 1rem 2rem",
  },
  logoImg: { display: "block", borderRadius: 8 },
  brandName: { fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-.01em" },
  nav: { display: "flex", gap: "2.2rem", flexWrap: "wrap", flex: 1, justifyContent: "center", padding: ".5rem 0" },
  navLink: { color: INK, textDecoration: "none", fontSize: 15.5, fontWeight: 600 },
  installBtn: {
    background: GREEN, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 15,
    padding: ".6rem 1.6rem", borderRadius: 6, marginLeft: "auto", marginRight: "2rem", whiteSpace: "nowrap",
  },
  installBtnLg: {
    display: "inline-block", background: GREEN, color: "#fff", textDecoration: "none", fontWeight: 700,
    fontSize: 16, padding: ".75rem 2.2rem", borderRadius: 6, border: "none", cursor: "pointer",
    boxShadow: `0 2px 0 ${GREEN_DARK}`,
  },

  hero: {
    display: "grid", gridTemplateColumns: "minmax(300px, 5fr) minmax(320px, 7fr)", alignItems: "center",
    gap: "2rem", background: SHADE, padding: "3.5rem 0 3.5rem 6vw", overflow: "hidden",
  },
  heroText: { maxWidth: 520 },
  heroKicker: { margin: 0, fontSize: 15, fontWeight: 700, color: "#9db3a7", letterSpacing: ".02em" },
  h1: {
    fontSize: "clamp(1.9rem, 3.4vw, 2.6rem)", lineHeight: 1.22, color: INK, fontWeight: 700,
    letterSpacing: "-.02em", margin: ".6rem 0 0",
  },
  heroSub: { fontSize: "1.02rem", margin: "1.1rem 0 1.8rem", maxWidth: 460 },
  heroArt: { minWidth: 0 },

  strip: {
    display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1rem 2.4rem",
    padding: "1.8rem 1.25rem", borderBottom: `1px solid ${LINE}`,
  },
  stripItem: { fontSize: 14.5, fontWeight: 600, color: "#8fa79b" },

  shaded: { background: SHADE, padding: "4rem 1.25rem" },
  section: { padding: "4rem 1.25rem" },
  center: { maxWidth: 760, margin: "0 auto", textAlign: "center" },
  centerSub: { margin: "1rem auto 0", maxWidth: 620 },
  h2: { fontSize: "clamp(1.6rem, 2.8vw, 2.1rem)", lineHeight: 1.25, color: INK, fontWeight: 700, letterSpacing: "-.02em", margin: 0 },
  h3: { fontSize: "clamp(1.15rem, 1.9vw, 1.45rem)", lineHeight: 1.3, color: INK, fontWeight: 700, margin: 0 },
  link: { color: GREEN, fontWeight: 600 },

  dataWrap: {
    maxWidth: 1080, margin: "0 auto", display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) minmax(300px, 2.1fr)", gap: "2.5rem", alignItems: "center",
  },
  dataGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1.1rem 1.5rem" },
  dataItem: { display: "flex", alignItems: "center", gap: ".7rem" },
  dataIcon: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
    width: 34, height: 34, borderRadius: "50%", background: GREEN,
  },
  dataLabel: { fontSize: 15.5, color: INK, fontWeight: 600 },
  dataFoot: { maxWidth: 1080, margin: "2.5rem auto 0", textAlign: "center", fontSize: 14.5, color: "#8fa79b" },

  features: { maxWidth: 1080, margin: "0 auto", padding: "1rem 1.25rem" },
  featureRow: {
    display: "flex", alignItems: "center", gap: "3rem", flexWrap: "wrap", padding: "3rem 0",
  },
  featureArt: { flex: "1 1 300px", minWidth: 280 },
  featureText: { flex: "1 1 320px", minWidth: 280 },
  featureBody: { margin: ".9rem 0 0", fontSize: "1rem" },

  sourceRow: { display: "flex", flexWrap: "wrap", gap: ".8rem", justifyContent: "center", marginTop: "2rem" },
  source: {
    display: "inline-flex", alignItems: "center", gap: 10, padding: ".7rem 1.2rem", borderRadius: 10,
    background: "#fff", border: `1px solid ${LINE}`,
  },
  sourceName: { fontSize: 15, color: INK, fontWeight: 600 },

  secGrid: {
    maxWidth: 1080, margin: "2.5rem auto 0", display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.2rem",
  },
  secCard: { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: "1.3rem 1.4rem" },
  secTitle: { fontSize: 16.5, color: INK, fontWeight: 700, margin: "0 0 .45rem" },
  secBody: { margin: 0, fontSize: 14.8 },
  secFoot: { textAlign: "center", marginTop: "1.8rem", fontSize: 15 },

  cta: { background: SHADE, padding: "4rem 1.25rem", textAlign: "center" },
  ctaTitle: { fontSize: "clamp(1.5rem, 2.6vw, 2rem)", color: INK, fontWeight: 700, margin: "0 0 1.5rem" },
  ctaForm: { display: "flex", gap: ".7rem", justifyContent: "center", flexWrap: "wrap" },
  ctaInput: {
    flex: "0 1 320px", padding: ".75rem 1rem", fontSize: 15, borderRadius: 6,
    border: `1px solid #b9c8c0`, background: "#fff", color: INK,
  },

  footer: { borderTop: `1px solid ${LINE}`, padding: "2.5rem 1.25rem 1.5rem" },
  footerCols: {
    maxWidth: 1080, margin: "0 auto", display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem",
  },
  footerHead: { color: INK, fontWeight: 700, fontSize: 15, margin: "0 0 .6rem" },
  footerLink: { display: "block", color: BODY, textDecoration: "none", fontSize: 14.5, padding: ".18rem 0" },
  footerBar: {
    maxWidth: 1080, margin: "2rem auto 0", paddingTop: "1.2rem", borderTop: `1px solid ${LINE}`,
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem",
    flexWrap: "wrap", fontSize: 14, color: "#8fa79b",
  },
  footerBrand: { display: "inline-flex", alignItems: "center", gap: 8, color: INK, fontWeight: 700 },
  footerIcon: { display: "block", borderRadius: 6 },
};

const mock = {
  window: {
    display: "flex", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14,
    boxShadow: "0 18px 40px rgba(22,48,42,.12)", overflow: "hidden", minHeight: 380,
  },
  side: { width: 168, background: "#fbfcfb", borderRight: `1px solid ${LINE}`, padding: ".9rem .6rem", flex: "none" },
  sideItem: { display: "block", fontSize: 13.5, color: "#7d9489", padding: ".42rem .6rem", borderRadius: 6 },
  sideItemActive: { background: "#e9f2ec", color: INK, fontWeight: 700 },
  main: { flex: 1, padding: "1.1rem 1.3rem", minWidth: 0 },
  crumb: { fontSize: 13, color: "#8fa79b", marginBottom: ".7rem" },
  badges: { display: "flex", gap: ".45rem", flexWrap: "wrap", marginBottom: "1rem" },
  badge: { fontSize: 12, color: "#5c6b63", background: "#f1f5f2", borderRadius: 999, padding: ".2rem .6rem" },
  badgeGreen: { fontSize: 12, color: "#1e5136", background: "#d7ecdf", borderRadius: 999, padding: ".2rem .6rem", fontWeight: 600 },
  progressTrack: { height: 8, borderRadius: 999, background: "#eaf0ec", overflow: "hidden" },
  progressFill: { width: "72%", height: "100%", background: GREEN, borderRadius: 999 },
  sheetsLabel: { fontSize: 13, fontWeight: 700, color: INK, margin: "1.1rem 0 .5rem" },
  sheetRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem",
    padding: ".55rem 0", borderTop: `1px solid ${LINE}`,
  },
  sheetName: { fontSize: 13.5, color: INK, fontWeight: 600, whiteSpace: "nowrap" },
  sheetTags: { display: "inline-flex", gap: ".35rem", flexWrap: "wrap", justifyContent: "flex-end" },
  tagNew: { fontSize: 11.5, color: "#1e5136", background: "#d7ecdf", borderRadius: 999, padding: ".12rem .5rem" },
  tagUpd: { fontSize: 11.5, color: "#1f4d70", background: "#dbeaf5", borderRadius: 999, padding: ".12rem .5rem" },
  tagTotal: { fontSize: 11.5, color: "#5c6b63", background: "#f1f5f2", borderRadius: 999, padding: ".12rem .5rem" },
};
