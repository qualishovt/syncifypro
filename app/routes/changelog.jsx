/** routes/changelog — What's new. */

import { SiteHeader, SiteFooter, THEME_CSS, THEME_BOOT, c, INK, GREEN, LINE } from "../components/SiteChrome.jsx";
import { CHANGELOG } from "../content/changelog.js";

export const meta = () => [
  { title: "What's new — SyncifyPro" },
  { name: "description", content: "Recent SyncifyPro releases: new data types, migration platforms, scheduling destinations and fixes." },
];

const TONE = {
  New: { color: "var(--mk-green-ink)", background: "var(--mk-green-soft)" },
  Improved: { color: "#1f4d70", background: "#dbeaf5" },
  Fixed: { color: "var(--mk-body)", background: "var(--mk-chip)" },
};

export default function Changelog() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/resources" style={c.back}>← Resources</a>
        <p style={c.kicker}>What&rsquo;s new</p>
        <h1 style={c.h1}>Releases and fixes</h1>
        <p style={c.lede}>What shipped recently. Only things that are actually live make this list.</p>

        {CHANGELOG.map((group) => (
          <section key={group.period} style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ ...c.h2, borderBottom: `1px solid ${LINE}`, paddingBottom: ".6rem" }}>{group.period}</h2>
            {group.entries.map(([tone, text]) => (
              <div key={text} style={{ display: "flex", gap: ".9rem", alignItems: "flex-start", margin: "0 0 .9rem" }}>
                <span style={{ ...TONE[tone], flex: "none", fontSize: 12, fontWeight: 700, borderRadius: 999, padding: ".18rem .7rem", marginTop: ".3rem" }}>{tone}</span>
                <p style={{ margin: 0, fontSize: "1.02rem", color: tone === "Fixed" ? undefined : INK }}>{text}</p>
              </div>
            ))}
          </section>
        ))}

        <div style={c.cta}>
          <p style={c.ctaTitle}>Something you need that isn&rsquo;t here?</p>
          <p style={{ margin: 0 }}>
            Tell us at <a href="mailto:support@syncifypro.app" style={{ color: GREEN }}>support@syncifypro.app</a> —
            feature requests from merchants shape this list.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
