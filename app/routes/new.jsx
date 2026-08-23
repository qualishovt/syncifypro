/**
 * routes/new — an ALTERNATE marketing design for syncifypro.app, served at /new
 * for review. Same substance as the main page (routes/_index) but a distinctly
 * different look: dark gradient hero, stat band, bento feature grid, numbered
 * steps, an FAQ accordion and a gradient CTA — drawing on the SaaS style of
 * Altera / SyncX / Cloneify rather than Matrixify's flat editorial layout.
 *
 * If approved, this replaces the MarketingPage in routes/_index.
 */

import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../shopify.server";
import PlatformLogo from "../components/PlatformLogos.jsx";

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

const NAV = [["How it works", "#how"], ["Features", "#features"], ["Data", "#data"], ["Migrate", "#migrate"], ["FAQ", "#faq"]];

const STATS = [
  ["32", "data types"],
  ["6", "source platforms"],
  ["5", "delivery destinations"],
  ["1-click", "scheduled runs"],
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

const FAQ = [
  ["Is it compatible with Matrixify files?", "SyncifyPro uses the same human-readable, round-trip spreadsheet approach, so if you already work that way you'll feel at home — export, edit, import."],
  ["How big a catalog can it handle?", "From ten products to well over a million. Large exports switch to Shopify's bulk operations automatically, so there's no practical ceiling."],
  ["Which formats can I use?", "Excel (.xlsx), CSV and Google Sheets for files; delivery to Email, FTP/SFTP, Amazon S3 and Google Drive for scheduled runs."],
  ["Which platforms can I migrate from?", "WooCommerce, BigCommerce, Magento, PrestaShop and OpenCart today, with URL redirects generated so your search rankings carry over."],
  ["Do I need to be technical?", "No. If you can work in a spreadsheet, you can run SyncifyPro. Every import is previewed before anything changes."],
];

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function NewMarketing() {
  const { showForm } = useLoaderData();
  return (
    <div style={s.root}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header style={s.header} className="nf-header">
        <a href="/" style={s.brand}>
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="34" height="34" style={{ borderRadius: 9 }} />
          <span style={s.brandName}>SyncifyPro</span>
        </a>
        <nav style={s.nav} className="nf-nav">
          {NAV.map(([l, h]) => <a key={h} href={h} style={s.navLink}>{l}</a>)}
        </nav>
        <a href="#install" style={s.navCta} className="nf-headcta">Install free</a>
      </header>

      <main>
        {/* hero */}
        <section style={s.hero} className="nf-hero">
          <div style={s.heroGlow} aria-hidden="true" />
          <div style={s.heroInner} className="nf-hero-inner">
            <div style={s.heroCol} className="nf-hero-col">
              <span style={s.eyebrow}>Shopify data, on your terms</span>
              <h1 style={s.h1} className="nf-h1">Bulk export, import, update &amp; migrate — without the busywork</h1>
              <p style={s.heroSub}>
                SyncifyPro turns your Shopify store into human-readable spreadsheets you can edit and
                import back in minutes — then schedules the whole thing so it runs itself.
              </p>
              <div style={s.heroBtns}>
                {showForm ? (
                  <Form method="post" action="/auth/login" style={s.heroForm} className="nf-heroform">
                    <input style={s.heroInput} type="text" name="shop" placeholder="your-store.myshopify.com" aria-label="Shop domain" autoComplete="off" />
                    <button style={s.btnPrimary} type="submit">Install free</button>
                  </Form>
                ) : (
                  <a href="#install" style={s.btnPrimary}>Install free</a>
                )}
              </div>
              <div style={s.proof}>
                <span style={s.stars}>★★★★★</span>
                <span style={s.proofText}>Built for merchants &amp; agencies · No credit card to install</span>
              </div>
            </div>
            <div style={s.heroArt} className="nf-hero-art"><AppMock /></div>
          </div>

          {/* stat band */}
          <div style={s.statBand} className="nf-stats">
            {STATS.map(([n, l]) => (
              <div key={l} style={s.stat}>
                <div style={s.statNum}>{n}</div>
                <div style={s.statLabel}>{l}</div>
              </div>
            ))}
          </div>
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
            <p style={s.ctaSub}>Install free and run your first export in under a minute.</p>
            {showForm && (
              <Form method="post" action="/auth/login" style={s.ctaForm} className="nf-ctaform">
                <input style={s.ctaInput} type="text" name="shop" placeholder="your-store.myshopify.com" aria-label="Shop domain" autoComplete="off" />
                <button style={s.btnPrimary} type="submit">Install free</button>
              </Form>
            )}
          </div>
        </section>
      </main>

      <footer style={s.footer} className="nf-footer">
        <div style={s.footBrand}>
          <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="30" height="30" style={{ borderRadius: 8 }} />
          <span style={s.brandName}>SyncifyPro</span>
        </div>
        <div style={s.footCols} className="nf-footcols">
          <div><p style={s.footHead}>Product</p><a href="#features" style={s.footLink}>Features</a><a href="#data" style={s.footLink}>Data types</a><a href="#migrate" style={s.footLink}>Migrate</a></div>
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

/** A compact browser-window mock of an import job (self-contained). */
function AppMock() {
  const rows = [
    ["Products", "New 6", "Upd 4"],
    ["Collections", "New 2", "Upd 1"],
    ["Customers", "—", "Upd 1"],
    ["Orders", "New 1", "—"],
  ];
  return (
    <div style={mock.win}>
      <div style={mock.bar}>
        <span style={{ ...mock.dot, background: "#ff5f57" }} /><span style={{ ...mock.dot, background: "#febc2e" }} /><span style={{ ...mock.dot, background: "#28c840" }} />
        <span style={mock.url}>SyncifyPro · Import #10024</span>
      </div>
      <div style={mock.body}>
        <div style={mock.badges}>
          <span style={mock.badgeGreen}>In progress</span>
          <span style={mock.badge}>Excel</span>
          <span style={mock.badge}>09:12</span>
        </div>
        <div style={mock.track}><div style={mock.fill} /></div>
        <p style={mock.sheetsLbl}>Sheets</p>
        {rows.map(([n, a, b]) => (
          <div key={n} style={mock.row}>
            <span style={mock.rowName}>{n}</span>
            <span style={mock.rowTags}>
              {a !== "—" && <span style={mock.tagNew}>{a}</span>}
              {b !== "—" && <span style={mock.tagUpd}>{b}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── palette & styles ──────────────────────────────────────────────────────── */

const INK = "#0d2019", BODY = "#4a5b53", GREEN = "#1f7a52", GREEN2 = "#33a06c", MINT = "#eafaf1", LINE = "#e2ece7", AMBER = "#f2a201";
const HEAD = "'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif";
const SANS = "'Segoe UI', Helvetica, Arial, sans-serif";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');
.nf-faq summary::-webkit-details-marker { display:none; }
.nf-faq[open] .nf-faqplus { transform: rotate(45deg); }
.nf-fcard { transition: transform .18s ease, box-shadow .18s ease; }
.nf-fcard:hover { transform: translateY(-3px); box-shadow: 0 22px 44px rgba(13,32,25,.12); }
.nf-srccard, .nf-datachip { transition: transform .15s ease; }
@media (max-width: 900px) {
  .nf-nav { display:none !important; }
  .nf-hero-inner { grid-template-columns: 1fr !important; text-align:center; }
  .nf-hero-col { align-items:center !important; }
  .nf-heroform, .nf-ctaform { margin-left:auto; margin-right:auto; }
  .nf-hero-art { margin: 0 auto !important; max-width: 460px; }
  .nf-bento { grid-template-columns: 1fr !important; }
  .nf-fcard-big { grid-column: auto !important; }
  .nf-steps, .nf-secgrid, .nf-footcols { grid-template-columns: 1fr !important; }
  .nf-datagrid { grid-template-columns: repeat(2,1fr) !important; }
  .nf-srcgrid { grid-template-columns: repeat(2,1fr) !important; }
}
@media (max-width: 560px) {
  .nf-h1 { font-size: 2rem !important; }
  .nf-heroform, .nf-ctaform { flex-direction: column !important; }
  .nf-heroform input, .nf-ctaform input { width: 100% !important; }
}
`;

const s = {
  root: { background: "#fff", color: BODY, fontFamily: SANS, lineHeight: 1.6, overflowX: "hidden", WebkitFontSmoothing: "antialiased" },

  header: { display: "flex", alignItems: "center", gap: "1.5rem", padding: "1rem 2rem", position: "sticky", top: 0, background: "rgba(255,255,255,.86)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${LINE}`, zIndex: 20 },
  brand: { display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", flex: "none" },
  brandName: { fontFamily: HEAD, fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-.02em" },
  nav: { display: "flex", gap: "1.8rem", flex: 1, justifyContent: "center" },
  navLink: { color: INK, textDecoration: "none", fontSize: 15, fontWeight: 600, opacity: .85 },
  navCta: { flex: "none", background: GREEN, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 14.5, padding: ".6rem 1.3rem", borderRadius: 999 },

  hero: { position: "relative", background: `linear-gradient(160deg, #08160f 0%, #0f2e1f 55%, #123a27 100%)`, color: "#dce9e2", padding: "4.5rem 2rem 0", overflow: "hidden" },
  heroGlow: { position: "absolute", top: "-30%", right: "-10%", width: "60vw", height: "60vw", background: `radial-gradient(circle, rgba(51,160,108,.35), transparent 60%)`, pointerEvents: "none" },
  heroInner: { position: "relative", maxWidth: 1160, margin: "0 auto", display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: "3rem", alignItems: "center" },
  heroCol: { display: "flex", flexDirection: "column", alignItems: "flex-start" },
  eyebrow: { display: "inline-block", fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#8fe3b8", background: "rgba(51,160,108,.14)", border: "1px solid rgba(143,227,184,.3)", borderRadius: 999, padding: ".35rem .9rem" },
  h1: { fontFamily: HEAD, fontSize: "clamp(2.2rem, 4.4vw, 3.4rem)", lineHeight: 1.08, letterSpacing: "-.025em", color: "#fff", margin: "1.2rem 0 0" },
  heroSub: { fontSize: "clamp(1rem, 1.5vw, 1.18rem)", color: "#bcd3c8", margin: "1.1rem 0 1.8rem", maxWidth: 540 },
  heroBtns: { width: "100%" },
  heroForm: { display: "flex", gap: ".6rem", maxWidth: 480 },
  heroInput: { flex: "1 1 auto", minWidth: 0, padding: ".85rem 1rem", fontSize: 15, borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.06)", color: "#fff" },
  btnPrimary: { flex: "none", background: `linear-gradient(180deg, ${GREEN2}, ${GREEN})`, color: "#fff", border: "none", fontWeight: 700, fontSize: 15, padding: ".85rem 1.6rem", borderRadius: 10, cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap", boxShadow: "0 10px 24px rgba(31,122,82,.4)" },
  proof: { display: "flex", alignItems: "center", gap: ".7rem", marginTop: "1.3rem", flexWrap: "wrap" },
  stars: { color: AMBER, letterSpacing: "2px", fontSize: 15 },
  proofText: { fontSize: 13.5, color: "#9fb8ac" },
  heroArt: { position: "relative" },

  statBand: { position: "relative", maxWidth: 1160, margin: "3.5rem auto 0", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, overflow: "hidden", transform: "translateY(38px)" },
  stat: { background: "#0c211700", backdropFilter: "blur(4px)", padding: "1.4rem 1rem", textAlign: "center" },
  statNum: { fontFamily: HEAD, fontSize: "1.9rem", fontWeight: 700, color: "#fff" },
  statLabel: { fontSize: 13.5, color: "#9fb8ac", marginTop: 2 },

  strip: { maxWidth: 1160, margin: "0 auto", padding: "4.5rem 2rem 1rem", textAlign: "center" },
  stripLabel: { fontSize: 12.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#9db3a7", margin: "0 0 1rem" },
  stripRow: { display: "flex", flexWrap: "wrap", gap: ".6rem", justifyContent: "center" },
  formatPill: { fontSize: 14, fontWeight: 600, color: INK, background: MINT, border: `1px solid ${LINE}`, borderRadius: 999, padding: ".45rem 1rem" },

  section: { maxWidth: 1160, margin: "0 auto", padding: "4.5rem 2rem" },
  sectionSoft: { maxWidth: "none", background: MINT, margin: 0 },
  sectionDark: { maxWidth: "none", background: `linear-gradient(160deg,#0f2e1f,#08160f)`, margin: 0 },
  secHead: { textAlign: "center", maxWidth: 640, margin: "0 auto 2.6rem" },
  kicker: { fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: GREEN },
  h2: { fontFamily: HEAD, fontSize: "clamp(1.7rem, 3vw, 2.4rem)", lineHeight: 1.15, letterSpacing: "-.02em", color: INK, margin: ".5rem 0 0" },

  bento: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "1.2rem" },
  fcard: { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "1.8rem", boxShadow: "0 1px 2px rgba(13,32,25,.04)" },
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
  dataChip: { display: "flex", alignItems: "center", gap: ".7rem", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: ".8rem 1rem", fontSize: 15, fontWeight: 600, color: INK },
  dataIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, background: MINT, color: GREEN, flex: "none" },

  srcGrid: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "1rem" },
  srcCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: ".7rem", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "1.4rem 1rem" },
  srcLogo: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, background: MINT },
  srcName: { fontSize: 14, fontWeight: 600, color: INK },
  srcFoot: { textAlign: "center", maxWidth: 620, margin: "1.8rem auto 0", fontSize: 15 },

  secGrid: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "1.2rem" },
  secCard: { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "1.6rem", borderLeft: `3px solid ${GREEN2}` },
  secTitle: { fontFamily: HEAD, fontSize: "1.15rem", color: INK, margin: "0 0 .4rem" },
  secBody: { fontSize: 14.5, margin: 0 },

  faqWrap: { maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: ".8rem" },
  faqItem: { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: "0 1.3rem" },
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
  footCols: { display: "grid", gridTemplateColumns: "repeat(2,auto)", gap: "3rem" },
  footHead: { fontSize: 13, fontWeight: 700, color: INK, margin: "0 0 .6rem" },
  footLink: { display: "block", color: BODY, textDecoration: "none", fontSize: 14, padding: ".2rem 0" },
  footCopy: { gridColumn: "1 / -1", fontSize: 13, color: "#9db3a7", margin: ".5rem 0 0" },
};

const mock = {
  win: { background: "#fff", borderRadius: 16, border: `1px solid ${LINE}`, boxShadow: "0 30px 60px rgba(0,0,0,.35)", overflow: "hidden" },
  bar: { display: "flex", alignItems: "center", gap: 7, padding: ".7rem 1rem", background: "#f3f6f4", borderBottom: `1px solid ${LINE}` },
  dot: { width: 11, height: 11, borderRadius: "50%" },
  url: { marginLeft: ".6rem", fontSize: 12.5, color: "#7d9489" },
  body: { padding: "1.2rem 1.3rem" },
  badges: { display: "flex", gap: ".4rem", marginBottom: "1rem" },
  badge: { fontSize: 12, color: "#5c6b63", background: "#f1f5f2", borderRadius: 999, padding: ".2rem .6rem" },
  badgeGreen: { fontSize: 12, color: "#1e5136", background: "#d7ecdf", borderRadius: 999, padding: ".2rem .6rem", fontWeight: 600 },
  track: { height: 8, borderRadius: 999, background: "#eaf0ec", overflow: "hidden" },
  fill: { width: "72%", height: "100%", background: GREEN2 },
  sheetsLbl: { fontSize: 13, fontWeight: 700, color: INK, margin: "1.1rem 0 .4rem" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".5rem 0", borderTop: `1px solid ${LINE}` },
  rowName: { fontSize: 13.5, fontWeight: 600, color: INK },
  rowTags: { display: "inline-flex", gap: ".35rem" },
  tagNew: { fontSize: 11.5, color: "#1e5136", background: "#d7ecdf", borderRadius: 999, padding: ".12rem .5rem" },
  tagUpd: { fontSize: 11.5, color: "#1f4d70", background: "#dbeaf5", borderRadius: 999, padding: ".12rem .5rem" },
};
