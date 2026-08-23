/** routes/resources/tutorials/:slug — a single walkthrough. */

import { useLoaderData } from "react-router";
import { SiteHeader, SiteFooter, Blocks, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import { TUTORIALS, getTutorial } from "../content/tutorials.js";

export const meta = ({ data }) =>
  data?.tutorial
    ? [{ title: `${data.tutorial.title} — SyncifyPro` }, { name: "description", content: data.tutorial.summary }]
    : [{ title: "Tutorial not found — SyncifyPro" }];

export async function loader({ params }) {
  const tutorial = getTutorial(params.slug);
  if (!tutorial) throw new Response("Not found", { status: 404 });
  return { tutorial, more: TUTORIALS.filter((t) => t.slug !== tutorial.slug).slice(0, 2) };
}

export default function Tutorial() {
  const { tutorial, more } = useLoaderData();
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/resources/tutorials" style={c.back}>← All tutorials</a>
        <p style={c.kicker}>Tutorial · {tutorial.minutes}</p>
        <h1 style={c.h1}>{tutorial.title}</h1>
        <p style={c.lede}>{tutorial.summary}</p>
        <Blocks blocks={tutorial.body} />
        <h2 style={c.groupTitle}>Next</h2>
        <div style={c.grid} className="sc-grid">
          {more.map((t) => (
            <a key={t.slug} href={`/resources/tutorials/${t.slug}`} style={c.card} className="sc-card">
              <h3 style={c.cardTitle}>{t.title}</h3>
              <p style={c.cardBody}>{t.summary}</p>
            </a>
          ))}
        </div>
        <div style={c.cta}>
          <p style={c.ctaTitle}>Try it on your store</p>
          <a href="/new#install" style={c.ctaBtn}>Install SyncifyPro</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
