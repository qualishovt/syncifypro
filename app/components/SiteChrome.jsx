/**
 * components/SiteChrome.jsx
 *
 * Shared shell for the public content pages (Resources, Blog). Gives them the
 * same header, footer, theme switch and palette as the marketing site, so a
 * doc page never looks like a different product.
 *
 * The marketing routes keep their own copy of the hero/section styles; this
 * module owns only what every content page needs.
 */

import { useEffect, useState } from "react";

export const INK = "var(--mk-ink)";
export const BODY = "var(--mk-body)";
export const GREEN = "var(--mk-green)";
export const LINE = "var(--mk-line)";
export const HEAD = "'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif";
export const SANS = "'Segoe UI', Helvetica, Arial, sans-serif";

export const SITE_NAV = [
  ["How it works", "/new#how"],
  ["Data types", "/new#data"],
  ["Compare", "/new#compare"],
];

/** The Resources drop-down — mirrors Matrixify's Knowledge menu, adapted to us. */
export const RESOURCES_MENU = [
  ["Documentation", "/resources/documentation", "How every part of the app works"],
  ["Tutorials & guides", "/resources/tutorials", "Step-by-step for common jobs"],
  ["Migrate to Shopify", "/resources/migrate", "One walkthrough per platform"],
  ["Data feeds", "/resources/data-feeds", "Scheduled product feeds"],
  ["Expert help", "/resources/experts", "Have us do the migration"],
  ["What's new", "/changelog", "Recent releases and fixes"],
];

export const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap');
:root {
  --mk-bg: #fff; --mk-card: #fff; --mk-surface: #fbfcfb; --mk-shade: #f5f8f6; --mk-chip: #f1f5f2;
  --mk-line: #e3ebe6; --mk-track: #eaf0ec; --mk-active: #e9f2ec; --mk-mint: #f2fbf6;
  --mk-ink: #16302a; --mk-body: #5c6b63; --mk-muted: #8fa79b;
  --mk-green: #1f8a5b; --mk-green-dark: #18714a; --mk-green-soft: #d3efe0; --mk-green-ink: #0f5a39;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --mk-bg: #0f1a15; --mk-card: #162420; --mk-surface: #13201b; --mk-shade: #132019; --mk-chip: #1d2d26;
  --mk-line: #25382f; --mk-track: #25382f; --mk-active: #1f3429; --mk-mint: #101d17;
  --mk-ink: #e8f0ec; --mk-body: #a9bbb1; --mk-muted: #7f948a;
  --mk-green: #3fb47e; --mk-green-dark: #2f9a68; --mk-green-soft: #173a2a; --mk-green-ink: #b5ead0;
  color-scheme: dark;
}
.sc-theme { display: inline-flex; border: 1px solid var(--mk-line); border-radius: 999px; padding: 2px; gap: 2px; background: var(--mk-chip); flex: none; }
.sc-theme button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 26px; border: 0; border-radius: 999px; background: transparent; color: var(--mk-muted); cursor: pointer; padding: 0; }
.sc-theme button[aria-pressed="true"] { background: var(--mk-bg); color: var(--mk-ink); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.sc-theme svg { width: 15px; height: 15px; }
.sc-card { transition: transform .16s ease, box-shadow .16s ease; }
.sc-card:hover { transform: translateY(-3px); box-shadow: 0 20px 40px rgba(13,32,25,.10); }
.sc-body a { color: var(--mk-green); }
@media (max-width: 900px) {
  .sc-nav { display: none !important; }
  .sc-brand { padding-left: 1.25rem !important; }
  .sc-theme { margin-left: auto; }
  .sc-install { margin-left: .6rem !important; margin-right: 1.25rem !important; padding: .55rem 1.2rem !important; }
  .sc-grid { grid-template-columns: 1fr !important; }
  .sc-foot { grid-template-columns: 1fr !important; }
}
`;

export const MENU_CSS = `
.sc-menu { position: relative; display: inline-block; }
.sc-menu > button { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: 0; padding: 0; cursor: pointer; font: inherit; color: var(--mk-ink); font-weight: 600; }
.sc-menu > button svg { width: 12px; height: 12px; transition: transform .16s ease; }
.sc-menu[data-open="true"] > button svg { transform: rotate(180deg); }
.sc-menu-panel { position: absolute; top: calc(100% + 14px); left: 50%; transform: translateX(-50%); min-width: 300px; background: var(--mk-card); border: 1px solid var(--mk-line); border-radius: 14px; box-shadow: 0 22px 48px rgba(13,32,25,.16); padding: .5rem; z-index: 40; }
/* The panel sits 14px below the button; this invisible strip fills that gap so
   the pointer stays inside .sc-menu on the way down and mouseleave doesn't fire. */
.sc-menu-panel::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; }
.sc-menu-panel a { display: block; padding: .6rem .8rem; border-radius: 9px; text-decoration: none; }
.sc-menu-panel a:hover { background: var(--mk-mint); }
.sc-menu-panel strong { display: block; font-size: 15px; font-weight: 700; color: var(--mk-ink); }
.sc-menu-panel span { display: block; font-size: 13px; color: var(--mk-muted); }
@media (max-width: 900px) { .sc-menu { display: none !important; } }
`;

export const THEME_CSS = BASE_CSS + MENU_CSS;

export const THEME_BOOT = `(function(){var k="sp-theme",m=matchMedia("(prefers-color-scheme: dark)");function a(){var p=localStorage.getItem(k)||"light";var d=p==="dark"||(p==="device"&&m.matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}window.__applyTheme=a;a();m.addEventListener("change",a);})();`;

const THEME_KEY = "sp-theme";
const THEME_OPTIONS = [
  ["light", "Light theme", <svg key="l" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>],
  ["dark", "Dark theme", <svg key="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>],
  ["device", "Use device theme", <svg key="d" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>],
];

export function ThemeToggle() {
  const [pref, setPref] = useState("light");
  useEffect(() => { setPref(window.localStorage.getItem(THEME_KEY) || "light"); }, []);
  const choose = (p) => { setPref(p); window.localStorage.setItem(THEME_KEY, p); window.__applyTheme?.(); };
  return (
    <div className="sc-theme" role="group" aria-label="Colour theme">
      {THEME_OPTIONS.map(([id, label, icon]) => (
        <button key={id} type="button" title={label} aria-label={label} aria-pressed={pref === id} onClick={() => choose(id)}>{icon}</button>
      ))}
    </div>
  );
}

/** Hover- and click-openable menu; closes on Escape, outside click or blur. */
export function ResourcesMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e) => { if (!e.target.closest?.(".sc-menu")) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [open]);
  return (
    <div className="sc-menu" data-open={open} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} style={c.navLink}>
        Resources
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="sc-menu-panel">
          {RESOURCES_MENU.map(([label, href, desc]) => (
            <a key={href} href={href}><strong>{label}</strong><span>{desc}</span></a>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  return (
    <header style={c.header}>
      <a href="/" style={c.brand} className="sc-brand">
        <img src="/brand/syncifypro-icon-rounded.svg" alt="" width="34" height="34" style={{ display: "block", borderRadius: 8 }} />
        <span style={c.brandName}>SyncifyPro</span>
      </a>
      <nav style={c.nav} className="sc-nav">
        {SITE_NAV.map(([label, href]) => <a key={href} href={href} style={c.navLink}>{label}</a>)}
        <ResourcesMenu />
        <a href="/blog" style={c.navLink}>Blog</a>
      </nav>
      <ThemeToggle />
      <a href="/new#install" style={c.install} className="sc-install">Install</a>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer style={c.footer}>
      <div style={c.footCols} className="sc-foot">
        <div>
          <p style={c.footHead}>Product</p>
          <a href="/new#features" style={c.footLink}>Features</a>
          <a href="/new#data" style={c.footLink}>Data types</a>
          <a href="/new#migrate" style={c.footLink}>Migrate</a>
        </div>
        <div>
          <p style={c.footHead}>Resources</p>
          <a href="/resources" style={c.footLink}>Guides</a>
          <a href="/blog" style={c.footLink}>Blog</a>
          <a href="/new#faq" style={c.footLink}>FAQ</a>
        </div>
        <div>
          <p style={c.footHead}>Company</p>
          <a href="mailto:support@syncifypro.app" style={c.footLink}>Contact us</a>
          <a href="/privacy" style={c.footLink}>Privacy Policy</a>
          <a href="/terms" style={c.footLink}>Terms of Service</a>
        </div>
      </div>
      <p style={c.footCopy}>© SyncifyPro · Operated by IntelliShop</p>
    </footer>
  );
}

/** Renders a content body made of simple blocks (see content/docs.js). */
/* eslint-disable react/prop-types */
export function Blocks({ blocks }) {
  return (
    <div className="sc-body">
      {blocks.map((b, i) => {
        const [kind, value] = b;
        if (kind === "h2") return <h2 key={i} style={c.h2}>{value}</h2>;
        if (kind === "h3") return <h3 key={i} style={c.h3}>{value}</h3>;
        if (kind === "ul") {
          return (
            <ul key={i} style={c.ul}>
              {value.map((li) => <li key={li} style={c.li}>{li}</li>)}
            </ul>
          );
        }
        if (kind === "steps") {
          return (
            <ol key={i} style={c.ol}>
              {value.map((li) => <li key={li} style={c.li}>{li}</li>)}
            </ol>
          );
        }
        if (kind === "note") return <p key={i} style={c.note}>{value}</p>;
        if (kind === "code") return <pre key={i} style={c.code}>{value}</pre>;
        return <p key={i} style={c.p}>{value}</p>;
      })}
    </div>
  );
}

export const c = {
  root: { background: "var(--mk-bg)", color: BODY, fontFamily: SANS, lineHeight: 1.7, minHeight: "100vh" },
  header: { display: "flex", alignItems: "center", gap: "1.5rem", borderBottom: `1px solid ${LINE}`, position: "sticky", top: 0, background: "var(--mk-bg)", zIndex: 20 },
  brand: { display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none", flex: "none", padding: "1rem 0 1rem 2rem" },
  brandName: { fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-.01em" },
  nav: { display: "flex", gap: "2rem", flexWrap: "wrap", flex: 1, justifyContent: "center", padding: ".5rem 0" },
  navLink: { color: INK, textDecoration: "none", fontSize: 17, fontWeight: 600 },
  install: { flex: "none", background: GREEN, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 16, padding: ".6rem 1.6rem", borderRadius: 6, marginLeft: "auto", marginRight: "2rem", whiteSpace: "nowrap" },

  wrap: { maxWidth: 1080, margin: "0 auto", padding: "3.5rem 2rem 4.5rem" },
  narrow: { maxWidth: 760, margin: "0 auto", padding: "3rem 2rem 4.5rem" },
  kicker: { fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: GREEN, margin: 0 },
  h1: { fontFamily: HEAD, fontSize: "clamp(2rem, 3.6vw, 2.9rem)", lineHeight: 1.15, letterSpacing: "-.02em", color: INK, margin: ".5rem 0 .8rem" },
  lede: { fontSize: "1.12rem", color: BODY, margin: "0 0 2rem", maxWidth: 640 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.2rem" },
  card: { display: "block", textDecoration: "none", background: "var(--mk-card)", border: `1px solid ${LINE}`, borderRadius: 16, padding: "1.4rem 1.5rem" },
  cardCat: { fontSize: 12.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: GREEN, margin: 0 },
  cardTitle: { fontFamily: HEAD, fontSize: "1.18rem", color: INK, margin: ".5rem 0 .4rem", lineHeight: 1.3 },
  cardBody: { fontSize: 14.8, color: BODY, margin: 0 },
  groupTitle: { fontFamily: HEAD, fontSize: "1.35rem", color: INK, margin: "2.6rem 0 1rem" },

  h2: { fontFamily: HEAD, fontSize: "1.5rem", color: INK, margin: "2.2rem 0 .7rem", letterSpacing: "-.01em" },
  h3: { fontFamily: HEAD, fontSize: "1.15rem", color: INK, margin: "1.6rem 0 .5rem" },
  p: { fontSize: "1.04rem", margin: "0 0 1rem" },
  ul: { margin: "0 0 1.2rem", paddingLeft: "1.2rem" },
  ol: { margin: "0 0 1.2rem", paddingLeft: "1.3rem" },
  li: { fontSize: "1.04rem", margin: ".35rem 0" },
  note: { fontSize: ".98rem", background: "var(--mk-mint)", borderLeft: `3px solid ${GREEN}`, borderRadius: 8, padding: ".9rem 1.1rem", margin: "0 0 1.2rem", color: INK },
  code: { fontSize: ".92rem", background: "var(--mk-chip)", border: `1px solid ${LINE}`, borderRadius: 8, padding: ".9rem 1.1rem", overflowX: "auto", margin: "0 0 1.2rem", color: INK, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  meta: { fontSize: 14, color: "var(--mk-muted)", margin: "0 0 2rem" },
  back: { display: "inline-block", fontSize: 14.5, fontWeight: 600, color: GREEN, textDecoration: "none", marginBottom: "1.2rem" },
  cta: { background: "var(--mk-mint)", border: `1px solid ${LINE}`, borderRadius: 16, padding: "1.6rem 1.8rem", marginTop: "2.5rem", textAlign: "center" },
  ctaTitle: { fontFamily: HEAD, fontSize: "1.25rem", color: INK, margin: "0 0 .5rem" },
  ctaBtn: { display: "inline-block", background: GREEN, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 15, padding: ".65rem 1.7rem", borderRadius: 6, marginTop: ".6rem" },

  footer: { borderTop: `1px solid ${LINE}`, padding: "2.5rem 2rem", maxWidth: 1080, margin: "0 auto" },
  footCols: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem" },
  footHead: { fontSize: 13, fontWeight: 700, color: INK, margin: "0 0 .6rem" },
  footLink: { display: "block", color: BODY, textDecoration: "none", fontSize: 14, padding: ".2rem 0" },
  footCopy: { fontSize: 13, color: "var(--mk-muted)", margin: "1.5rem 0 0" },
};
