/** routes/resources/documentation — every guide, grouped by category. */

import { SiteHeader, SiteFooter, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { DOCS, DOC_CATEGORIES } from "../content/docs.js";

export const meta = () => [
  { title: "Documentation — SyncifyPro" },
  { name: "description", content: "How every part of SyncifyPro works: exporting, importing, the Command column, scheduling, migrations, security and troubleshooting." },
];

export default function Documentation() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.wrap}>
        <a href="/resources" style={c.back}>← Resources</a>
        <p style={c.kicker}>Documentation</p>
        <h1 style={c.h1}>How the app works</h1>
        <p style={c.lede}>Reference for every part of SyncifyPro, from your first export to how your data is stored.</p>
        {DOC_CATEGORIES.map((cat) => {
          const docs = DOCS.filter((d) => d.category === cat);
          if (!docs.length) return null;
          return (
            <section key={cat}>
              <h2 style={c.groupTitle}>{cat}</h2>
              <div style={c.grid} className="sc-grid">
                {docs.map((d) => (
                  <a key={d.slug} href={`/resources/${d.slug}`} style={c.card} className="sc-card">
                    <h3 style={c.cardTitle}>{d.title}</h3>
                    <p style={c.cardBody}>{d.summary}</p>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </main>
      <SiteFooter />
    </div>
  );
}
