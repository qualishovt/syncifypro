/** routes/resources — the Resources hub: every guide, grouped by category. */

import { SiteHeader, SiteFooter, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { DOCS, DOC_CATEGORIES } from "../content/docs.js";

export const meta = () => [
  { title: "Resources — guides for SyncifyPro" },
  { name: "description", content: "Guides for exporting, importing, bulk-updating, scheduling and migrating Shopify store data with SyncifyPro." },
];

export default function Resources() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.wrap}>
        <p style={c.kicker}>Resources</p>
        <h1 style={c.h1}>Guides for getting your data where you want it</h1>
        <p style={c.lede}>
          Everything from your first export to migrating a whole store. Short, practical, and written
          against what the app actually does.
        </p>

        {DOC_CATEGORIES.map((cat) => {
          const docs = DOCS.filter((d) => d.category === cat);
          if (!docs.length) return null;
          return (
            <section key={cat}>
              <h2 style={c.groupTitle}>{cat}</h2>
              <div style={c.grid} className="sc-grid">
                {docs.map((d) => (
                  <a key={d.slug} href={`/resources/${d.slug}`} style={c.card} className="sc-card">
                    <p style={c.cardCat}>{d.category}</p>
                    <h3 style={c.cardTitle}>{d.title}</h3>
                    <p style={c.cardBody}>{d.summary}</p>
                  </a>
                ))}
              </div>
            </section>
          );
        })}

        <div style={c.cta}>
          <p style={c.ctaTitle}>Can&rsquo;t find what you need?</p>
          <p style={{ margin: 0 }}>Open the chat in the app, or email support@syncifypro.app and we&rsquo;ll help.</p>
          <a href="/blog" style={c.ctaBtn}>Read the blog</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
