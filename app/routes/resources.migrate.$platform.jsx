/** routes/resources/migrate/:platform — one platform walkthrough. */

import { useLoaderData } from "react-router";
import { SiteHeader, SiteFooter, Blocks, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import PlatformLogo from "../components/PlatformLogos.jsx";
import { MIGRATION_GUIDES, getMigrationGuide } from "../content/migrationGuides.js";

export const meta = ({ data }) =>
  data?.guide
    ? [{ title: `${data.guide.title} — SyncifyPro` }, { name: "description", content: data.guide.summary }]
    : [{ title: "Guide not found — SyncifyPro" }];

export async function loader({ params }) {
  const guide = getMigrationGuide(params.platform);
  if (!guide) throw new Response("Not found", { status: 404 });
  return { guide, others: MIGRATION_GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 3) };
}

export default function MigrateGuide() {
  const { guide, others } = useLoaderData();
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/resources/migrate" style={c.back}>← All platforms</a>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <PlatformLogo id={guide.platform} size={34} />
          <h1 style={{ ...c.h1, margin: 0 }}>{guide.title}</h1>
        </span>
        <p style={{ ...c.lede, marginTop: "1rem" }}>{guide.summary}</p>
        <p style={c.note}><strong>Comes across:</strong> {guide.entities}</p>
        <Blocks blocks={guide.body} />
        <h2 style={c.groupTitle}>Other platforms</h2>
        <div style={c.grid} className="sc-grid">
          {others.map((g) => (
            <a key={g.slug} href={`/resources/migrate/${g.slug}`} style={c.card} className="sc-card">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <PlatformLogo id={g.platform} size={20} />
                <h3 style={{ ...c.cardTitle, margin: 0, fontSize: "1.05rem" }}>{g.title}</h3>
              </span>
            </a>
          ))}
        </div>
        <div style={c.cta}>
          <p style={c.ctaTitle}>Ready to move?</p>
          <a href="/new#install" style={c.ctaBtn}>Install SyncifyPro</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
