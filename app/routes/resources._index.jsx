/** routes/resources — the hub: the six sections, then the newest guides and posts. */

import { SiteHeader, SiteFooter, RESOURCES_MENU, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { DOCS } from "../content/docs.js";
import { TUTORIALS } from "../content/tutorials.js";
import { POSTS, formatDate } from "../content/posts.js";

export const meta = () => [
  { title: "Resources — SyncifyPro" },
  { name: "description", content: "Documentation, tutorials, migration walkthroughs, data feeds, expert help and release notes for SyncifyPro." },
];

export default function Resources() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.wrap}>
        <p style={c.kicker}>Resources</p>
        <h1 style={c.h1}>Everything you need to move your data</h1>
        <p style={c.lede}>
          Documentation for how the app works, tutorials for the jobs you actually have, a walkthrough
          per migration platform, and notes on what shipped.
        </p>

        <div style={c.grid} className="sc-grid">
          {RESOURCES_MENU.map(([label, href, desc]) => (
            <a key={href} href={href} style={c.card} className="sc-card">
              <h2 style={c.cardTitle}>{label}</h2>
              <p style={c.cardBody}>{desc}</p>
            </a>
          ))}
        </div>

        <h2 style={c.groupTitle}>Popular guides</h2>
        <div style={c.grid} className="sc-grid">
          {DOCS.slice(0, 3).map((d) => (
            <a key={d.slug} href={`/resources/${d.slug}`} style={c.card} className="sc-card">
              <p style={c.cardCat}>{d.category}</p>
              <h3 style={c.cardTitle}>{d.title}</h3>
              <p style={c.cardBody}>{d.summary}</p>
            </a>
          ))}
        </div>

        <h2 style={c.groupTitle}>Start with a tutorial</h2>
        <div style={c.grid} className="sc-grid">
          {TUTORIALS.slice(0, 3).map((t) => (
            <a key={t.slug} href={`/resources/tutorials/${t.slug}`} style={c.card} className="sc-card">
              <p style={c.cardCat}>{t.minutes}</p>
              <h3 style={c.cardTitle}>{t.title}</h3>
              <p style={c.cardBody}>{t.summary}</p>
            </a>
          ))}
        </div>

        <h2 style={c.groupTitle}>From the blog</h2>
        <div style={c.grid} className="sc-grid">
          {POSTS.slice(0, 2).map((p) => (
            <a key={p.slug} href={`/blog/${p.slug}`} style={c.card} className="sc-card">
              <p style={c.cardCat}>{formatDate(p.date)} · {p.readingTime}</p>
              <h3 style={c.cardTitle}>{p.title}</h3>
              <p style={c.cardBody}>{p.excerpt}</p>
            </a>
          ))}
        </div>

        <div style={c.cta}>
          <p style={c.ctaTitle}>Can&rsquo;t find what you need?</p>
          <p style={{ margin: 0 }}>Open the chat in the app, or email support@syncifypro.app and we&rsquo;ll help.</p>
          <a href="/resources/experts" style={c.ctaBtn}>Get expert help</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
