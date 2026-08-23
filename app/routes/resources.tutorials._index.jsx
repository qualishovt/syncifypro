/** routes/resources/tutorials — task walkthroughs. */

import { SiteHeader, SiteFooter, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { TUTORIALS } from "../content/tutorials.js";

export const meta = () => [
  { title: "Tutorials & guides — SyncifyPro" },
  { name: "description", content: "Step-by-step walkthroughs: bulk price changes, tags, inventory, safe deletes, accounting exports and fixing failed imports." },
];

export default function Tutorials() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.wrap}>
        <a href="/resources" style={c.back}>← Resources</a>
        <p style={c.kicker}>Tutorials &amp; guides</p>
        <h1 style={c.h1}>Step-by-step for the jobs you actually have</h1>
        <p style={c.lede}>Each one walks a single task end to end, with the file you need and what to check before you commit.</p>
        <div style={c.grid} className="sc-grid">
          {TUTORIALS.map((t) => (
            <a key={t.slug} href={`/resources/tutorials/${t.slug}`} style={c.card} className="sc-card">
              <p style={c.cardCat}>{t.minutes}</p>
              <h2 style={c.cardTitle}>{t.title}</h2>
              <p style={c.cardBody}>{t.summary}</p>
            </a>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
