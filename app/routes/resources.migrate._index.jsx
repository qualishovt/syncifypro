/** routes/resources/migrate — migration hub, one card per platform. */

import { SiteHeader, SiteFooter, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";
import PlatformLogo from "../components/PlatformLogos.jsx";
import { MIGRATION_GUIDES } from "../content/migrationGuides.js";

export const meta = () => [
  { title: "Migrate to Shopify — SyncifyPro" },
  { name: "description", content: "Walkthroughs for migrating WooCommerce, BigCommerce, Magento, PrestaShop and OpenCart stores into Shopify, with redirects." },
];

export default function MigrateHub() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.wrap}>
        <a href="/resources" style={c.back}>← Resources</a>
        <p style={c.kicker}>Migrate to Shopify</p>
        <h1 style={c.h1}>Bring your old store with you</h1>
        <p style={c.lede}>
          A migration reads your current store, builds a normal import file, and runs it through the same
          preview every import gets. Pick your platform for the exact steps.
        </p>
        <div style={c.grid} className="sc-grid">
          {MIGRATION_GUIDES.map((g) => (
            <a key={g.slug} href={`/resources/migrate/${g.slug}`} style={c.card} className="sc-card">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <PlatformLogo id={g.platform} size={24} />
                <h2 style={{ ...c.cardTitle, margin: 0 }}>{g.title}</h2>
              </span>
              <p style={{ ...c.cardBody, marginTop: ".5rem" }}>{g.summary}</p>
            </a>
          ))}
        </div>
        <h2 style={c.groupTitle}>Something else?</h2>
        <p>
          Etsy migrations are handled by our team rather than self-serve — Etsy&rsquo;s API terms don&rsquo;t allow
          migration apps. Email <a href="mailto:support@syncifypro.app">support@syncifypro.app</a> and we&rsquo;ll
          take it from there. Same for any platform not listed above: if you can export it, we can usually import it.
        </p>
        <div style={c.cta}>
          <p style={c.ctaTitle}>Moving a store this month?</p>
          <a href="/new#install" style={c.ctaBtn}>Install SyncifyPro</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
