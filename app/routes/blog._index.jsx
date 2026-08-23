/** routes/blog — post index. */

import { SiteHeader, SiteFooter, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { POSTS, formatDate } from "../content/posts.js";

export const meta = () => [
  { title: "Blog — SyncifyPro" },
  { name: "description", content: "Practical writing about bulk-editing, migrating and automating Shopify store data." },
];

export default function Blog() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.wrap}>
        <p style={c.kicker}>Blog</p>
        <h1 style={c.h1}>Notes on moving store data around</h1>
        <p style={c.lede}>Practical write-ups from the work behind the app — bulk edits, migrations and automation.</p>
        <div style={c.grid} className="sc-grid">
          {POSTS.map((p) => (
            <a key={p.slug} href={`/blog/${p.slug}`} style={c.card} className="sc-card">
              <p style={c.cardCat}>{formatDate(p.date)} · {p.readingTime}</p>
              <h2 style={c.cardTitle}>{p.title}</h2>
              <p style={c.cardBody}>{p.excerpt}</p>
            </a>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
