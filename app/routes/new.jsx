/**
 * routes/new — an ALTERNATE marketing design for syncifypro.app, served at /new
 * for review. Same substance as the main page (routes/_index) but a distinctly
 * different look: dark gradient hero, stat band, bento feature grid, numbered
 * steps, an FAQ accordion and a gradient CTA — drawing on the SaaS style of
 * Altera / SyncX / Cloneify rather than Matrixify's flat editorial layout.
 *
 * If approved, this replaces the MarketingPage in routes/_index.
 */

import { useEffect, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { login } from "../shopify.server";
import PlatformLogo from "../components/PlatformLogos.jsx";
import { ResourcesMenu, MENU_CSS } from "../components/SiteChrome.jsx";

export const meta = () => [
  { title: "SyncifyPro — Bulk Export, Import, Update, Schedule & Migrate for Shopify" },
  { name: "description", content: "Export, import, update, schedule and migrate Shopify store data with Excel and CSV files — products, customers, orders and 30+ more data types." },
  { name: "robots", content: "noindex" },
];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return { showForm: Boolean(login) };
};

/* ── content (mirrors routes/_index) ───────────────────────────────────────── */

const NAV = [["How it works", "#how"], ["Data types", "#data"], ["Migrate", "#migrate"]];

const SI = { viewBox: "0 0 24 24", width: 24, height: 24, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const STAT_ICONS = {
  grid: <svg {...SI}><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></svg>,
  globe: <svg {...SI}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18" /></svg>,
  send: <svg {...SI}><path d="M21.5 3.5 2.8 10.1l7 2.6 2.6 7 9.1-16.2Z" /><path d="m9.8 12.7 11.7-9.2" /></svg>,
  clock: <svg {...SI}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.3l3.4 2" /></svg>,
};

const STATS = [
  ["grid", "32 data types", "Products, orders, customers & more"],
  ["globe", "6 source platforms", "WooCommerce, Magento, PrestaShop…"],
  ["send", "5 delivery destinations", "Email, FTP/SFTP, S3, Google Drive"],
  ["clock", "1-click scheduling", "Hourly to monthly, on autopilot"],
];

const FORMATS = ["Excel (.xlsx)", "CSV", "Google Sheets", "FTP / SFTP", "Amazon S3", "Google Drive", "Email"];

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
  { badge: "Export & Import", title: "Bulk export and import with spreadsheets you already know", body: "Every sheet is human-readable and round-trips: export it, edit in Excel, CSV or Google Sheets, import it straight back. Filters and column control keep files exactly as big as you need.", big: true },
  { badge: "Update", title: "Update existing data in bulk", body: "300 items or 300 thousand — update only the columns you care about. Preview every run before it writes.", big: false },
  { badge: "Schedule", title: "Schedule it once, then forget it", body: "Hourly to monthly, delivered to email, FTP/SFTP, Amazon S3, Google Drive or Sheets — each run with its own history.", big: false },
  { badge: "Migrate", title: "Move another store into Shopify", body: "Pull products, customers, orders, categories and coupons from WooCommerce, BigCommerce, Magento, PrestaShop, OpenCart or Etsy — with URL redirects generated so your SEO survives.", big: true },
];

const STEPS = [
  ["Connect or export", "Install in a click and export any of 32 data types, or connect another platform to pull its catalog."],
  ["Edit in a spreadsheet", "Open the file in Excel, CSV or Google Sheets, make your bulk changes, and keep only the columns you touched."],
  ["Import & schedule", "Import straight back with a full preview, then put it on a schedule and let it run on its own."],
];

const SOURCES = [["woocommerce", "WooCommerce"], ["bigcommerce", "BigCommerce"], ["magento", "Magento"], ["prestashop", "PrestaShop"], ["opencart", "OpenCart"], ["etsy", "Etsy"]];

const SECURITY = [
  ["Preview before it writes", "Imports show every record and what will be created, updated or skipped before a single change reaches your store."],
  ["Encrypted end to end", "TLS in transit, encrypted at rest, server credentials sealed with AES-256-GCM that never return to your browser."],
  ["Deleted when you say so", "Files expire on the retention you set, any job can be erased, and uninstalling removes everything for your shop."],
  ["Shopify's data rules, followed", "Protected customer data handled per Shopify's requirements, with the mandatory privacy webhooks implemented."],
];

const COMPARE_COLS = ["SyncifyPro", "Matrixify", "Altera"];
const COMPARE_ROWS = [
  ["Shopify data types covered", "32", "18", "23"],
  ["File formats", "Excel, CSV, XML, JSON, PDF, Sheets", "Excel, CSV, Sheets", "Excel, CSV, Sheets"],
  ["Migrate from another platform", "WooCommerce, BigCommerce, Magento, PrestaShop, OpenCart", "Yes — platforms not listed", "WooCommerce"],
  ["Scheduled, repeating jobs", true, true, "On paid plans, via CLI"],
  ["Delivery to Email, FTP/SFTP, S3, Drive", "All four", "Not listed", "Google Drive"],
  ["Built-in live chat support", true, "—", "—"],
  ["Handles six-figure catalogs", true, true, true],
];

const FAQ = [
  ["Is it compatible with Matrixify files?", "SyncifyPro uses the same human-readable, round-trip spreadsheet approach, so if you already work that way you'll feel at home — export, edit, import."],
  ["How big a catalog can it handle?", "From ten products to well over a million. Large exports switch to Shopify's bulk operations automatically, so there's no practical ceiling."],
  ["Which formats can I use?", "Excel (.xlsx), CSV and Google Sheets for files; delivery to Email, FTP/SFTP, Amazon S3 and Google Drive for scheduled runs."],
  ["Which platforms can I migrate from?", "WooCommerce, BigCommerce, Magento, PrestaShop and OpenCart today, with URL redirects generated so your search rankings carry over."],
  ["Do I need to be technical?", "No. If you can work in a spreadsheet, you can run SyncifyPro. Every import is previewed before anything changes."],
];

/* ── theme system (identical to the homepage) ──────────────────────────────── */
const THEME_KEY = "sp-theme";
const THEME_OPTIONS = [
  ["light", "Light theme", <svg key="l" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>],
  ["dark", "Dark theme", <svg key="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>],
  ["device", "Use device theme", <svg key="d" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>],
];
function ThemeToggle() {
  const [pref, setPref] = useState("light");
  useEffect(() => { setPref(window.localStorage.getItem(THEME_KEY) || "light"); }, []);
  const choose = (p) => { setPref(p); window.localStorage.setItem(THEME_KEY, p); window.__applyTheme?.(); };
  return (
    <div className="nf-theme" role="group" aria-label="Colour theme">
      {THEME_OPTIONS.map(([id, label, icon]) => (
        <button key={id} type="button" title={label} aria-label={label} aria-pressed={pref === id} onClick={() => choose(id)}>{icon}</button>
      ))}
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function NewMarketing() {
  useLoaderData();
  return (
    <div style={s.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS + MENU_CSS + CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />

      <header style={s.header} className="nf-header">
        <a href="/" style={s.brand} className="nf-brand">
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="34" height="34" style={{ display: "block", borderRadius: 8 }} />
          <span style={s.brandName}>SyncifyPro</span>
        </a>
        <nav style={s.nav} className="nf-nav">
          {NAV.map(([l, h]) => <a key={h} href={h} style={s.navLink}>{l}</a>)}
          <ResourcesMenu />
          <a href="/blog" style={s.navLink}>Blog</a>
        </nav>
        <ThemeToggle />
        <a href="#install" style={s.navCta} className="nf-install-top">Install</a>
      </header>

      <main>
        {/* hero — identical to the homepage hero */}
        <section style={s.hero} className="nf-hero">
          <div style={s.heroInner} className="nf-hero-inner">
            <div style={s.heroText} className="nf-hero-text">
              <p style={s.heroKicker}>Shopify App</p>
              <h1 style={s.h1}>SyncifyPro: Shopify Data Bulk Export, Import, Update &amp; Migrate</h1>
              <p style={s.heroSub} className="nf-hero-sub">
                Manage your Shopify store data by bulk exporting and importing human-readable Excel and
                CSV files — and migrate a whole store from another platform.
              </p>
              <div style={s.heroBtns}>
                <a href="#install" style={s.installBtnLg}>Install</a>
                <a href="#compare" style={s.compareBtnLg}>Compare</a>
              </div>
            </div>
            <div style={s.heroArt}><AppMock /></div>
          </div>
        </section>

        {/* stat band */}
        <section style={s.statSection}>
          <div style={s.statRow} className="nf-stats">
            {STATS.map(([g, value, caption]) => (
              <div key={value} style={s.statItem}>
                <span style={s.statIcon}>
                  {STAT_ICONS[g]}
                </span>
                <span>
                  <span style={s.statNum}>{value}</span>
                  <span style={s.statLabel}>{caption}</span>
                </span>
              </div>
            ))}
          </div>
          <div style={s.statRule}><div style={s.statRuleLine} /></div>
        </section>

        {/* formats strip */}
        <section style={s.strip}>
          <p style={s.stripLabel}>Files &amp; destinations</p>
          <div style={s.stripRow} className="nf-strip">
            {FORMATS.map((f) => <span key={f} style={s.formatPill}>{f}</span>)}
          </div>
        </section>

        {/* features — bento */}
        <section id="features" style={s.section}>
          <SectionHead kicker="Everything in one app" title="Four tools, one workflow" />
          <div style={s.bento} className="nf-bento">
            {FEATURES.map((f) => (
              <article key={f.title} style={{ ...s.fcard, ...(f.big ? s.fcardBig : null) }} className={f.big ? "nf-fcard nf-fcard-big" : "nf-fcard"}>
                <span style={s.fbadge}>{f.badge}</span>
                <h3 style={s.ftitle}>{f.title}</h3>
                <p style={s.fbody}>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" style={{ ...s.section, ...s.sectionDark }} className="nf-dark">
          <SectionHead kicker="How it works" title="From store to spreadsheet and back" dark />
          <div style={s.steps} className="nf-steps">
            {STEPS.map(([t, b], i) => (
              <div key={t} style={s.step}>
                <div style={s.stepNum}>{String(i + 1).padStart(2, "0")}</div>
                <h3 style={s.stepTitle}>{t}</h3>
                <p style={s.stepBody}>{b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* data types */}
        <section id="data" style={s.section}>
          <SectionHead kicker="32 data types" title="Export nearly everything in your store" />
          <div style={s.dataGrid} className="nf-datagrid">
            {DATA_TYPES.map(([name, g]) => (
              <div key={name} style={s.dataChip}>
                <span style={s.dataIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={GLYPH[g]} /></svg>
                </span>
                {name}
              </div>
            ))}
          </div>
        </section>

        {/* migrate */}
        <section id="migrate" style={{ ...s.section, ...s.sectionSoft }}>
          <SectionHead kicker="Switching to Shopify?" title="Migrate a whole store in one import" />
          <div style={s.srcGrid} className="nf-srcgrid">
            {SOURCES.map(([id, name]) => (
              <div key={id} style={s.srcCard}>
                <span style={s.srcLogo}><PlatformLogo id={id} size={30} /></span>
                <span style={s.srcName}>{name}</span>
              </div>
            ))}
          </div>
          <p style={s.srcFoot}>Products, customers, orders, categories and coupons — with URL redirects generated so your SEO survives the move.</p>
        </section>

        {/* security */}
        <section id="security" style={s.section}>
          <SectionHead kicker="Safe by default" title="Your data, handled carefully" />
          <div style={s.secGrid} className="nf-secgrid">
            {SECURITY.map(([t, b]) => (
              <article key={t} style={s.secCard}>
                <h3 style={s.secTitle}>{t}</h3>
                <p style={s.secBody}>{b}</p>
              </article>
            ))}
          </div>
        </section>

        {/* compare */}
        <section id="compare" style={{ ...s.section, ...s.sectionMint }}>
          <SectionHead kicker="Compare" title="Why merchants pick SyncifyPro" />
          <div style={s.tableWrap} className="nf-tablewrap">
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.thLabel}> </th>
                  {COMPARE_COLS.map((c, i) => (
                    <th key={c} style={i === 0 ? s.thUs : s.th}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map(([label, ...cells]) => (
                  <tr key={label}>
                    <th scope="row" style={s.rowHead}>{label}</th>
                    {cells.map((v, i) => (
                      <td key={COMPARE_COLS[i]} style={i === 0 ? s.tdUs : s.td}>
                        {v === true ? <span style={i === 0 ? s.yes : s.yesAlt}>✓</span> : v === false ? <span style={s.no}>—</span> : v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={s.tableFoot}>
            Based on what each app publishes on its own site (matrixify.app, getaltera.com), checked 23 August 2026.
            Feature sets change — please check their pages for the latest.
          </p>
        </section>

        {/* FAQ */}
        <section id="faq" style={{ ...s.section, ...s.sectionSoft }}>
          <SectionHead kicker="FAQ" title="Questions, answered" />
          <div style={s.faqWrap}>
            {FAQ.map(([q, a]) => (
              <details key={q} style={s.faqItem} className="nf-faq">
                <summary style={s.faqQ}>{q}<span style={s.faqPlus} aria-hidden="true">+</span></summary>
                <p style={s.faqA}>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section id="install" style={s.ctaWrap}>
          <div style={s.ctaCard} className="nf-cta">
            <h2 style={s.ctaTitle}>Start managing your Shopify data today</h2>
            <p style={s.ctaSub}>Install and run your first export in under a minute.</p>
            <a href="https://apps.shopify.com/syncifypro" style={s.btnPrimary}>Install on the Shopify App Store</a>
          </div>
        </section>
      </main>

      <footer style={s.footer} className="nf-footer">
        <div style={s.footBrand}>
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="30" height="30" style={{ display: "block", borderRadius: 8 }} />
          <span style={s.brandName}>SyncifyPro</span>
        </div>
        <div style={s.footCols} className="nf-footcols">
          <div><p style={s.footHead}>Product</p><a href="#features" style={s.footLink}>Features</a><a href="#data" style={s.footLink}>Data types</a><a href="#migrate" style={s.footLink}>Migrate</a></div>
          <div><p style={s.footHead}>Resources</p><a href="/resources" style={s.footLink}>Guides</a><a href="/blog" style={s.footLink}>Blog</a><a href="#faq" style={s.footLink}>FAQ</a></div>
          <div><p style={s.footHead}>Company</p><a href="mailto:support@syncifypro.app" style={s.footLink}>Contact us</a><a href="/privacy" style={s.footLink}>Privacy Policy</a><a href="/terms" style={s.footLink}>Terms of Service</a></div>
        </div>
        <p style={s.footCopy}>© SyncifyPro · Operated by IntelliShop</p>
      </footer>
    </div>
  );
}

/* eslint-disable react/prop-types */
function SectionHead({ kicker, title, dark }) {
  return (
    <div style={s.secHead}>
      <span style={{ ...s.kicker, ...(dark ? { color: "#8fe3b8" } : null) }}>{kicker}</span>
      <h2 style={{ ...s.h2, ...(dark ? { color: "#fff" } : null) }}>{title}</h2>
    </div>
  );
}

/** The hero app-mock: a slideshow through SyncifyPro's sections. */
const MOCK_NAV = ["Home", "Export", "Import", "Schedules", "Migrations", "Activity"];

function SlideHome() {
  return (
    <>
      <div style={mock.crumb}>SyncifyPro / Home</div>
      <div style={mock.homeCard}>
        <p style={mock.cardTitle}>Export</p>
        <p style={mock.cardBody}>Products, orders, customers and more to Excel, CSV, JSON or XML.</p>
        <span style={mock.cardBtn}>New export</span>
      </div>
      <div style={mock.homeCard}>
        <p style={mock.cardTitle}>Import</p>
        <div style={mock.drop}>Add file or drop it here</div>
      </div>
    </>
  );
}

function SlideExport() {
  const rows = [["Products", "12,480"], ["Variants", "18,204"], ["Collections", "96"], ["Customers", "3,902"], ["Orders", "11,540"]];
  return (
    <>
      <div style={mock.crumb}>SyncifyPro / Export: Products</div>
      <div style={mock.badges}>
        <span style={mock.badgeGreen}>Format: Excel</span>
        <span style={mock.badge}>Filters: 2</span>
        <span style={mock.badge}>Columns: 24</span>
      </div>
      <p style={mock.sheetsLabel}>What to export</p>
      {rows.map(([name, count], i) => (
        <div key={name} style={mock.sheetRow} className="nf-sheetrow">
          <span style={mock.rowLeft}>
            <span style={i < 2 ? mock.checkOn : mock.checkOff}>{i < 2 ? "✓" : ""}</span>
            {name}
          </span>
          <span style={mock.sheetTags} className="nf-sheettags">
            <span style={mock.tagTotal}>{count}</span>
          </span>
        </div>
      ))}
    </>
  );
}

function SlideImport() {
  const sheets = [
    ["Products", "New: 6", "Updated: 4", "Total: 10"],
    ["Custom Collections", "New: 2", "Updated: 1", "Total: 3"],
    ["Customers", "Updated: 1", null, "Total: 1"],
    ["Orders", "New: 1", null, "Total: 1"],
  ];
  return (
    <>
      <div style={mock.crumb}>SyncifyPro / Import: #10024</div>
      <div style={mock.badges}>
        <span style={mock.badgeGreen}>In progress</span>
        <span style={mock.badge}>Format: Excel</span>
        <span style={mock.badge}>Started: 09:12</span>
      </div>
      <div style={mock.progressTrack}><div style={mock.progressFill} /></div>
      <p style={mock.sheetsLabel}>Sheets</p>
      {sheets.map(([name, a, b, total]) => (
        <div key={name} style={mock.sheetRow} className="nf-sheetrow">
          <span style={mock.sheetName}>{name}</span>
          <span style={mock.sheetTags} className="nf-sheettags">
            {a && <span style={mock.tagNew}>{a}</span>}
            {b && <span style={mock.tagUpd}>{b}</span>}
            <span style={mock.tagTotal}>{total}</span>
          </span>
        </div>
      ))}
    </>
  );
}

function SlideSchedules() {
  const rows = [
    ["Daily products export", "Daily 06:00", "Email"],
    ["Weekly orders backup", "Weekly · Mon", "Amazon S3"],
    ["Hourly inventory sync", "Hourly", "FTP / SFTP"],
    ["Monthly customers", "Monthly · 1st", "Google Drive"],
  ];
  return (
    <>
      <div style={mock.crumb}>SyncifyPro / Schedules</div>
      <div style={mock.badges}>
        <span style={mock.badgeGreen}>4 active</span>
        <span style={mock.badge}>Next run: 06:00</span>
      </div>
      <p style={mock.sheetsLabel}>Scheduled jobs</p>
      {rows.map(([name, freq, dest]) => (
        <div key={name} style={mock.sheetRow} className="nf-sheetrow">
          <span style={mock.rowLeft}><span style={mock.dot} />{name}</span>
          <span style={mock.sheetTags} className="nf-sheettags">
            <span style={mock.tagUpd}>{freq}</span>
            <span style={mock.tagTotal}>{dest}</span>
          </span>
        </div>
      ))}
    </>
  );
}

function SlideMigrations() {
  const rows = [
    ["woocommerce", "WooCommerce", true],
    ["bigcommerce", "BigCommerce", true],
    ["magento", "Magento", true],
    ["prestashop", "PrestaShop", false],
    ["opencart", "OpenCart", false],
  ];
  return (
    <>
      <div style={mock.crumb}>SyncifyPro / Migrations</div>
      <div style={mock.badges}>
        <span style={mock.badgeGreen}>3 connected</span>
        <span style={mock.badge}>Redirects: on</span>
      </div>
      <p style={mock.sheetsLabel}>Source platforms</p>
      {rows.map(([id, name, on]) => (
        <div key={id} style={mock.sheetRow} className="nf-sheetrow">
          <span style={mock.rowLeft}><PlatformLogo id={id} size={16} />{name}</span>
          <span style={mock.sheetTags} className="nf-sheettags">
            <span style={on ? mock.tagNew : mock.tagTotal}>{on ? "Connected" : "Not connected"}</span>
          </span>
        </div>
      ))}
    </>
  );
}

function SlideActivity() {
  const rows = [
    ["Products export", "Completed", "12,480 rows"],
    ["Customers import", "Completed", "3,902 rows"],
    ["Orders export", "Running", "62%"],
    ["Inventory update", "Completed", "640 rows"],
  ];
  return (
    <>
      <div style={mock.crumb}>SyncifyPro / Activity</div>
      <div style={mock.badges}>
        <span style={mock.badgeGreen}>Today</span>
        <span style={mock.badge}>4 jobs</span>
      </div>
      <p style={mock.sheetsLabel}>Recent jobs</p>
      {rows.map(([name, status, detail]) => (
        <div key={name} style={mock.sheetRow} className="nf-sheetrow">
          <span style={mock.rowLeft}>{name}</span>
          <span style={mock.sheetTags} className="nf-sheettags">
            <span style={status === "Running" ? mock.tagRun : mock.tagNew}>{status}</span>
            <span style={mock.tagTotal}>{detail}</span>
          </span>
        </div>
      ))}
    </>
  );
}

const SLIDES = [SlideHome, SlideExport, SlideImport, SlideSchedules, SlideMigrations, SlideActivity];
const SLIDE_MS = 4500;

function AppMock() {
  const [i, setI] = useState(2);      // opens on the Import job
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setInterval(() => setI((n) => (n + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [paused]);

  const Slide = SLIDES[i];
  return (
    <div>
      <div
        style={mock.window}
        className="nf-mock"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div style={mock.side} className="nf-mock-side">
          {MOCK_NAV.map((it, n) => (
            <button
              key={it}
              type="button"
              onClick={() => setI(n)}
              style={{ ...mock.sideBtn, ...(n === i ? mock.sideItemActive : null) }}
            >
              {it}
            </button>
          ))}
        </div>
        <div style={mock.main} className="nf-slide" key={i}><Slide /></div>
      </div>
      <div style={mock.dots} className="nf-dots">
        {SLIDES.map((_, n) => (
          <button key={MOCK_NAV[n]} type="button" aria-label={"Show " + MOCK_NAV[n]} aria-current={n === i} onClick={() => setI(n)} />
        ))}
      </div>
    </div>
  );
}

/* ── palette & styles ──────────────────────────────────────────────────────── */

const INK = "var(--mk-ink)", BODY = "var(--mk-body)", GREEN = "var(--mk-green)", GREEN2 = "#33a06c", MINT = "var(--mk-green-soft)", LINE = "var(--mk-line)", AMBER = "#f2a201";
const HEAD = "'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif";
const SANS = "'Segoe UI', Helvetica, Arial, sans-serif";

const THEME_CSS = `
:root {
  --mk-bg: #fff; --mk-card: #fff; --mk-surface: #fbfcfb; --mk-shade: #f5f8f6; --mk-chip: #f1f5f2;
  --mk-line: #e3ebe6; --mk-track: #eaf0ec; --mk-active: #e9f2ec; --mk-art-line: #cfe3d7;
  --mk-ink: #16302a; --mk-body: #5c6b63; --mk-muted: #8fa79b;
  --mk-green: #45795a; --mk-green-dark: #38634a; --mk-green-soft: #d7ecdf; --mk-green-ink: #1e5136;
  --mk-blue-soft: #dbeaf5; --mk-blue-ink: #1f4d70; --mk-mint: #f2fbf6;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --mk-bg: #0f1a15; --mk-card: #162420; --mk-surface: #13201b; --mk-shade: #132019; --mk-chip: #1d2d26;
  --mk-line: #25382f; --mk-track: #25382f; --mk-active: #1f3429; --mk-art-line: #2f4d3d;
  --mk-ink: #e8f0ec; --mk-body: #a9bbb1; --mk-muted: #7f948a;
  --mk-green: #5ea67b; --mk-green-dark: #4d8f66; --mk-green-soft: #1f3b2c; --mk-green-ink: #bfe5cd;
  --mk-blue-soft: #1c2f3e; --mk-blue-ink: #a8cdea; --mk-mint: #101d17;
  color-scheme: dark;
}
.nf-theme { display: inline-flex; border: 1px solid var(--mk-line); border-radius: 999px; padding: 2px; gap: 2px; background: var(--mk-chip); flex: none; }
.nf-theme button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 26px; border: 0; border-radius: 999px; background: transparent; color: var(--mk-muted); cursor: pointer; padding: 0; }
.nf-theme button[aria-pressed="true"] { background: var(--mk-bg); color: var(--mk-ink); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.nf-theme svg { width: 15px; height: 15px; }
`;
const THEME_BOOT = `(function(){var k="sp-theme",m=matchMedia("(prefers-color-scheme: dark)");function a(){var p=localStorage.getItem(k)||"light";var d=p==="dark"||(p==="device"&&m.matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}window.__applyTheme=a;a();m.addEventListener("change",a);})();`;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');
.nf-faq summary::-webkit-details-marker { display:none; }
.nf-slide { animation: nfFade .4s ease; }
@keyframes nfFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.nf-dots button { width: 8px; height: 8px; border-radius: 999px; border: 0; padding: 0; background: var(--mk-muted); cursor: pointer; transition: width .2s ease, background .2s ease; }
.nf-dots button:hover { background: var(--mk-ink); }
.nf-dots button[aria-current="true"] { width: 20px; background: var(--mk-green); }
@media (prefers-reduced-motion: reduce) { .nf-slide { animation: none; } }
.nf-faq[open] .nf-faqplus { transform: rotate(45deg); }
.nf-fcard { transition: transform .18s ease, box-shadow .18s ease; }
.nf-fcard:hover { transform: translateY(-3px); box-shadow: 0 22px 44px rgba(13,32,25,.12); }
.nf-srccard, .nf-datachip { transition: transform .15s ease; }
@media (max-width: 900px) {
  .nf-nav { display:none !important; }
  .nf-brand { padding-left: 1.25rem !important; }
  .nf-theme { margin-left: auto; }
  .nf-install-top { margin-left: .6rem !important; margin-right: 1.25rem !important; padding: .55rem 1.2rem !important; }
  .nf-hero-inner { grid-template-columns: 1fr !important; padding: 2.5rem 1.25rem !important; text-align:center; }
  .nf-hero-text { max-width:100% !important; margin:0 auto; }
  .nf-hero-sub { max-width:100% !important; margin-left:auto !important; margin-right:auto !important; }
  .nf-ctaform { margin-left:auto; margin-right:auto; }
  .nf-hero-art { margin: 0 auto !important; max-width: 520px; }
  .nf-bento { grid-template-columns: 1fr !important; }
  .nf-fcard-big { grid-column: auto !important; }
  .nf-steps, .nf-secgrid, .nf-footcols { grid-template-columns: 1fr !important; }
  .nf-datagrid { grid-template-columns: repeat(2,1fr) !important; }
  .nf-srcgrid { grid-template-columns: repeat(2,1fr) !important; }
}
@media (max-width: 560px) {
  .nf-ctaform { flex-direction: column !important; }
  .nf-ctaform input { width: 100% !important; }
  .nf-mock-side { display:none !important; }
  .nf-sheetrow { flex-direction: column !important; align-items: flex-start !important; gap:.4rem !important; }
  .nf-sheettags { justify-content: flex-start !important; }
}
`;

const s = {
  root: { background: "var(--mk-bg)", color: BODY, fontFamily: SANS, lineHeight: 1.6, overflowX: "hidden", WebkitFontSmoothing: "antialiased" },

  header: { display: "flex", alignItems: "center", gap: "1.5rem", borderBottom: `1px solid ${LINE}`, position: "sticky", top: 0, background: "var(--mk-bg)", zIndex: 20 },
  brand: { display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", flex: "none", padding: "1rem 0 1rem 2rem" },
  brandName: { fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-.01em" },
  nav: { display: "flex", gap: "2.2rem", flexWrap: "wrap", flex: 1, justifyContent: "center", padding: ".5rem 0" },
  navLink: { color: INK, textDecoration: "none", fontSize: 18, fontWeight: 600 },
  compareBtnLg: { display: "inline-block", background: "var(--mk-card)", color: GREEN, textDecoration: "none", fontWeight: 700, fontSize: 16, padding: ".75rem 2.2rem", borderRadius: 6, border: "1px solid " + GREEN, cursor: "pointer" },
  navCta: { flex: "none", background: GREEN, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 16, padding: ".6rem 1.6rem", borderRadius: 6, marginLeft: "auto", marginRight: "2rem", whiteSpace: "nowrap" },
  tableWrap: { maxWidth: 1040, margin: "0 auto", overflowX: "auto", border: "1px solid " + LINE, borderRadius: 18, background: "var(--mk-card)", boxShadow: "0 14px 34px rgba(13,32,25,.07)" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 640 },
  thLabel: { textAlign: "left", padding: "1rem 1.2rem", borderBottom: "1px solid " + LINE, width: "38%" },
  th: { textAlign: "center", padding: "1rem .9rem", fontSize: 14.5, fontWeight: 700, color: "var(--mk-muted)", borderBottom: "1px solid " + LINE, borderLeft: "1px solid " + LINE },
  thUs: { textAlign: "center", padding: "1.1rem .9rem", fontSize: 16, fontWeight: 700, color: "#fff", background: GREEN, borderBottom: "1px solid " + LINE, borderLeft: "1px solid " + LINE },
  rowHead: { textAlign: "left", padding: ".85rem 1.2rem", fontSize: 14.5, fontWeight: 600, color: "var(--mk-ink)", borderBottom: "1px solid " + LINE },
  td: { textAlign: "center", padding: ".85rem .9rem", fontSize: 14, color: "var(--mk-body)", borderBottom: "1px solid " + LINE, borderLeft: "1px solid " + LINE },
  tdUs: { textAlign: "center", padding: ".85rem .9rem", fontSize: 14, fontWeight: 600, color: "var(--mk-ink)", background: "var(--mk-green-soft)", borderBottom: "1px solid " + LINE, borderLeft: "1px solid " + LINE },
  yes: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "var(--mk-green)", color: "#fff", fontSize: 12, fontWeight: 700 },
  yesAlt: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "var(--mk-green-soft)", color: "var(--mk-green-ink)", fontSize: 12, fontWeight: 700 },
  no: { color: "var(--mk-muted)" },
  tableFoot: { textAlign: "center", marginTop: "1.1rem", fontSize: 13.5, color: "var(--mk-muted)" },

  hero: { position: "relative", background: "var(--mk-shade)", color: BODY, overflow: "hidden" },
  heroText: { maxWidth: 520 },
  heroKicker: { margin: 0, fontSize: 15, fontWeight: 700, color: "var(--mk-muted)", letterSpacing: ".02em" },
  heroArt: { minWidth: 0 },
  installBtnLg: { display: "inline-block", background: "var(--mk-green)", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 16, padding: ".75rem 2.2rem", borderRadius: 6, border: "none", cursor: "pointer", boxShadow: "0 2px 0 #38634a" },
  statSection: { padding: "2.5rem 0 0" },
  statRule: { maxWidth: 1200, margin: "2.2rem auto 0", padding: "0 2rem" },
  statRuleLine: { height: 1, background: LINE },
  heroGlow: { position: "absolute", top: "-30%", right: "-12%", width: "55vw", height: "55vw", background: "radial-gradient(circle, rgba(51,160,108,.14), transparent 62%)", pointerEvents: "none" },
  heroInner: { position: "relative", display: "grid", gridTemplateColumns: "minmax(300px, 5fr) minmax(320px, 7fr)", alignItems: "center", gap: "2rem", padding: "3.5rem 0 3.5rem 6vw" },
  heroCol: { display: "flex", flexDirection: "column", alignItems: "flex-start" },
  eyebrow: { display: "inline-block", fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: GREEN, background: "#e4f3ea", border: "1px solid #cbe7d6", borderRadius: 999, padding: ".35rem .9rem" },
  h1: { fontSize: "clamp(1.9rem, 3.4vw, 2.6rem)", lineHeight: 1.22, color: "var(--mk-ink)", fontWeight: 700, letterSpacing: "-.02em", margin: ".6rem 0 0", maxWidth: 520 },
  heroSub: { fontSize: "1.14rem", margin: "1.1rem 0 1.8rem", maxWidth: 480, color: "var(--mk-body)" },
  heroBtns: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".7rem" },
  heroForm: { display: "flex", gap: ".6rem", maxWidth: 480 },
  heroInput: { flex: "1 1 auto", minWidth: 0, padding: ".85rem 1rem", fontSize: 15, borderRadius: 10, border: `1px solid ${LINE}`, background: "var(--mk-card)", color: INK },
  btnPrimary: { flex: "none", background: `linear-gradient(180deg, ${GREEN2}, ${GREEN})`, color: "#fff", border: "none", fontWeight: 700, fontSize: 15, padding: ".85rem 1.6rem", borderRadius: 10, cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap", boxShadow: "0 10px 24px rgba(31,122,82,.4)" },
  proof: { display: "flex", alignItems: "center", gap: ".7rem", marginTop: "1.3rem", flexWrap: "wrap" },
  stars: { color: AMBER, letterSpacing: "2px", fontSize: 15 },
  proofText: { fontSize: 13.5, color: "var(--mk-muted)" },

  statRow: { maxWidth: 1200, margin: "0 auto", padding: "0 2rem", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1.6rem 2.6rem" },
  statItem: { display: "inline-flex", alignItems: "center", gap: ".7rem" },
  statIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--mk-green)", flex: "none" },
  statNum: { display: "block", fontFamily: HEAD, fontSize: "1.12rem", fontWeight: 700, color: INK, lineHeight: 1.25 },
  statLabel: { display: "block", fontSize: 13, color: "var(--mk-muted)" },

  strip: { maxWidth: 1160, margin: "0 auto", padding: "3.5rem 2rem 1rem", textAlign: "center" },
  stripLabel: { fontSize: 14, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--mk-muted)", margin: "0 0 1rem" },
  stripRow: { display: "flex", flexWrap: "wrap", gap: ".6rem", justifyContent: "center" },
  formatPill: { fontSize: 16, fontWeight: 600, color: INK, background: MINT, border: `1px solid ${LINE}`, borderRadius: 999, padding: ".55rem 1.2rem" },

  section: { maxWidth: 1160, margin: "0 auto", padding: "4.5rem 2rem" },
  sectionSoft: { maxWidth: "none", background: "var(--mk-shade)", margin: 0 },
  sectionMint: { maxWidth: "none", background: "var(--mk-mint)", margin: 0 },
  sectionDark: { maxWidth: "none", background: `linear-gradient(160deg,#0f2e1f,#08160f)`, margin: 0 },
  secHead: { textAlign: "center", maxWidth: 640, margin: "0 auto 2.6rem" },
  kicker: { fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: GREEN },
  h2: { fontFamily: HEAD, fontSize: "clamp(1.7rem, 3vw, 2.4rem)", lineHeight: 1.15, letterSpacing: "-.02em", color: INK, margin: ".5rem 0 0" },

  bento: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "1.2rem" },
  fcard: { background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 20, padding: "1.8rem", boxShadow: "0 1px 2px rgba(13,32,25,.04)" },
  fcardBig: { gridColumn: "span 1" },
  fbadge: { display: "inline-block", fontSize: 12.5, fontWeight: 700, color: GREEN, background: MINT, borderRadius: 999, padding: ".3rem .8rem" },
  ftitle: { fontFamily: HEAD, fontSize: "1.3rem", color: INK, margin: ".9rem 0 .5rem", letterSpacing: "-.01em", lineHeight: 1.25 },
  fbody: { fontSize: 15, margin: 0 },

  steps: { maxWidth: 1160, margin: "0 auto", padding: "0 2rem", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "2rem" },
  step: {},
  stepNum: { fontFamily: HEAD, fontSize: "2.6rem", fontWeight: 700, color: "#2f7d58", lineHeight: 1 },
  stepTitle: { fontFamily: HEAD, fontSize: "1.25rem", color: "#fff", margin: ".8rem 0 .5rem" },
  stepBody: { fontSize: 15, color: "#a9c4b7", margin: 0 },

  dataGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: ".8rem" },
  dataChip: { display: "flex", alignItems: "center", gap: ".7rem", background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 12, padding: ".8rem 1rem", fontSize: 15, fontWeight: 600, color: INK },
  dataIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, background: MINT, color: GREEN, flex: "none" },

  srcGrid: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "1rem" },
  srcCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: ".7rem", background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 16, padding: "1.4rem 1rem" },
  srcLogo: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, background: MINT },
  srcName: { fontSize: 14, fontWeight: 600, color: INK },
  srcFoot: { textAlign: "center", maxWidth: 620, margin: "1.8rem auto 0", fontSize: 15 },

  secGrid: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "1.2rem" },
  secCard: { background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 16, padding: "1.6rem", borderLeft: `3px solid ${GREEN2}` },
  secTitle: { fontFamily: HEAD, fontSize: "1.15rem", color: INK, margin: "0 0 .4rem" },
  secBody: { fontSize: 14.5, margin: 0 },

  faqWrap: { maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: ".8rem" },
  faqItem: { background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 14, padding: "0 1.3rem" },
  faqQ: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", cursor: "pointer", listStyle: "none", padding: "1.1rem 0", fontFamily: HEAD, fontSize: "1.05rem", fontWeight: 600, color: INK },
  faqPlus: { fontSize: 22, color: GREEN, transition: "transform .18s ease", lineHeight: 1 },
  faqA: { margin: "0 0 1.1rem", fontSize: 15 },

  ctaWrap: { padding: "4.5rem 2rem" },
  ctaCard: { position: "relative", overflow: "hidden", maxWidth: 900, margin: "0 auto", background: `linear-gradient(150deg,#0f2e1f,#1f7a52)`, borderRadius: 26, padding: "3.2rem 2rem", textAlign: "center", boxShadow: "0 30px 70px rgba(15,46,31,.35)" },
  ctaTitle: { fontFamily: HEAD, fontSize: "clamp(1.6rem,3vw,2.2rem)", color: "#fff", margin: "0 0 .5rem", letterSpacing: "-.02em" },
  ctaSub: { color: "#bcd3c8", margin: "0 0 1.6rem", fontSize: 16 },
  ctaForm: { display: "flex", gap: ".6rem", justifyContent: "center", flexWrap: "wrap" },
  ctaInput: { flex: "0 1 340px", padding: ".85rem 1rem", fontSize: 15, borderRadius: 10, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.1)", color: "#fff" },

  footer: { borderTop: `1px solid ${LINE}`, padding: "2.5rem 2rem", display: "grid", gridTemplateColumns: "1fr auto", gap: "1.5rem", maxWidth: 1160, margin: "0 auto", alignItems: "start" },
  footBrand: { display: "inline-flex", alignItems: "center", gap: 10 },
  footCols: { display: "grid", gridTemplateColumns: "repeat(3,auto)", gap: "2.4rem" },
  footHead: { fontSize: 13, fontWeight: 700, color: INK, margin: "0 0 .6rem" },
  footLink: { display: "block", color: BODY, textDecoration: "none", fontSize: 14, padding: ".2rem 0" },
  footCopy: { gridColumn: "1 / -1", fontSize: 13, color: "var(--mk-muted)", margin: ".5rem 0 0" },
};

const mock = {
  window: { display: "flex", background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: "0 18px 40px rgba(22,48,42,.12)", overflow: "hidden", minHeight: 380 },
  side: { width: 168, background: "var(--mk-surface)", borderRight: `1px solid ${LINE}`, padding: ".9rem .6rem", flex: "none" },
  sideItem: { display: "block", fontSize: 13.5, color: "var(--mk-muted)", padding: ".42rem .6rem", borderRadius: 6 },
  sideItemActive: { background: "var(--mk-active)", color: "var(--mk-ink)", fontWeight: 700 },
  main: { flex: 1, padding: "1.1rem 1.3rem", minWidth: 0, minHeight: 320 },
  sideBtn: { display: "block", width: "100%", textAlign: "left", fontSize: 13.5, color: "var(--mk-muted)", padding: ".42rem .6rem", borderRadius: 6, background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit" },
  rowLeft: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--mk-ink)", fontWeight: 600, whiteSpace: "nowrap" },
  checkOn: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: 4, background: "var(--mk-green)", color: "#fff", fontSize: 10, lineHeight: 1, flex: "none" },
  checkOff: { display: "inline-block", width: 15, height: 15, borderRadius: 4, border: "1px solid " + LINE, flex: "none" },
  dot: { display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "var(--mk-green)", flex: "none" },
  tagRun: { fontSize: 11.5, color: "#8a5a00", background: "#ffe9b8", borderRadius: 999, padding: ".12rem .5rem" },
  homeCard: { border: "1px solid " + LINE, borderRadius: 10, padding: ".85rem 1rem", marginBottom: ".7rem" },
  cardTitle: { margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--mk-ink)" },
  cardBody: { margin: ".3rem 0 .6rem", fontSize: 12.5, color: "var(--mk-body)" },
  cardBtn: { display: "inline-block", fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--mk-green)", borderRadius: 6, padding: ".3rem .8rem" },
  drop: { border: "1px dashed " + LINE, borderRadius: 8, padding: "1.1rem", textAlign: "center", fontSize: 12.5, color: "var(--mk-muted)" },
  dots: { display: "flex", gap: 6, justifyContent: "center", marginTop: 14 },
  crumb: { fontSize: 13, color: "var(--mk-muted)", marginBottom: ".7rem" },
  badges: { display: "flex", gap: ".45rem", flexWrap: "wrap", marginBottom: "1rem" },
  badge: { fontSize: 12, color: "var(--mk-body)", background: "var(--mk-chip)", borderRadius: 999, padding: ".2rem .6rem" },
  badgeGreen: { fontSize: 12, color: "var(--mk-green-ink)", background: "var(--mk-green-soft)", borderRadius: 999, padding: ".2rem .6rem", fontWeight: 600 },
  progressTrack: { height: 8, borderRadius: 999, background: "var(--mk-track)", overflow: "hidden" },
  progressFill: { width: "72%", height: "100%", background: "var(--mk-green)", borderRadius: 999 },
  sheetsLabel: { fontSize: 13, fontWeight: 700, color: "var(--mk-ink)", margin: "1.1rem 0 .5rem" },
  sheetRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", padding: ".55rem 0", borderTop: `1px solid ${LINE}` },
  sheetName: { fontSize: 13.5, color: "var(--mk-ink)", fontWeight: 600, whiteSpace: "nowrap" },
  sheetTags: { display: "inline-flex", gap: ".35rem", flexWrap: "wrap", justifyContent: "flex-end" },
  tagNew: { fontSize: 11.5, color: "var(--mk-green-ink)", background: "var(--mk-green-soft)", borderRadius: 999, padding: ".12rem .5rem" },
  tagUpd: { fontSize: 11.5, color: "var(--mk-blue-ink)", background: "var(--mk-blue-soft)", borderRadius: 999, padding: ".12rem .5rem" },
  tagTotal: { fontSize: 11.5, color: "var(--mk-body)", background: "var(--mk-chip)", borderRadius: 999, padding: ".12rem .5rem" },
};
