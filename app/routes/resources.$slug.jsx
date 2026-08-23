/** routes/resources/:slug — a single guide. */

import { useLoaderData } from "react-router";
import { SiteHeader, SiteFooter, Blocks, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { DOCS, getDoc } from "../content/docs.js";

export const meta = ({ data }) =>
  data?.doc
    ? [{ title: `${data.doc.title} — SyncifyPro` }, { name: "description", content: data.doc.summary }]
    : [{ title: "Guide not found — SyncifyPro" }];

export async function loader({ params }) {
  const doc = getDoc(params.slug);
  if (!doc) throw new Response("Not found", { status: 404 });
  const related = DOCS.filter((d) => d.category === doc.category && d.slug !== doc.slug).slice(0, 2);
  return { doc, related };
}

export default function Doc() {
  const { doc, related } = useLoaderData();
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/resources" style={c.back}>← All guides</a>
        <p style={c.kicker}>{doc.category}</p>
        <h1 style={c.h1}>{doc.title}</h1>
        <p style={c.lede}>{doc.summary}</p>
        <Blocks blocks={doc.body} />

        {related.length > 0 && (
          <>
            <h2 style={c.groupTitle}>Related</h2>
            <div style={c.grid} className="sc-grid">
              {related.map((d) => (
                <a key={d.slug} href={`/resources/${d.slug}`} style={c.card} className="sc-card">
                  <h3 style={c.cardTitle}>{d.title}</h3>
                  <p style={c.cardBody}>{d.summary}</p>
                </a>
              ))}
            </div>
          </>
        )}

        <div style={c.cta}>
          <p style={c.ctaTitle}>Ready to try it?</p>
          <a href="/new#install" style={c.ctaBtn}>Install SyncifyPro</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
