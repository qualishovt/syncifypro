/** routes/resources/experts — assisted migrations and done-for-you help. */

import { SiteHeader, SiteFooter, Blocks, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";

export const meta = () => [
  { title: "Expert help — SyncifyPro" },
  { name: "description", content: "Have the SyncifyPro team run your migration or bulk update for you, or get help when a file will not behave." },
];

const BODY = [
  ["p", "Most people never need this page: export, edit, import, done. But a migration carrying ten years of history, or a catalog that has to go live on a fixed date, is worth a second pair of hands."],
  ["h2", "What we help with"],
  ["ul", [
    "Running a full migration for you — we connect the old store, map the data, and hand you a file that is ready to import.",
    "Etsy migrations, which are assisted only: Etsy's API terms do not permit migration apps, so our team handles those case by case.",
    "Platforms not on the list. If your old store can export its data at all, we can usually shape it into an import file.",
    "Rescuing a bulk change that went wrong, using your exports and job history.",
    "Setting up recurring feeds and imports against a supplier's server.",
  ]],
  ["h2", "How to ask"],
  ["p", "Email support@syncifypro.app or open the chat in the app. Tell us the platform you are coming from, roughly how many products, customers and orders you have, and the date you want to be live. That is enough for us to say what is involved."],
  ["note", "Live chat inside the app carries your shop domain automatically, so we can look at the exact job you are asking about without a round of “which store is this?”."],
  ["h2", "For agencies"],
  ["p", "If you move client stores for a living and want a standing arrangement — shared processes, a direct line during launches — say so in your first message and we will set it up. We are a small team, which is the point: you talk to the people who wrote the importer."],
];

export default function Experts() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/resources" style={c.back}>← Resources</a>
        <p style={c.kicker}>Expert help</p>
        <h1 style={c.h1}>Have us do it for you</h1>
        <p style={c.lede}>Assisted migrations, awkward files and launch-day deadlines.</p>
        <Blocks blocks={BODY} />
        <div style={c.cta}>
          <p style={c.ctaTitle}>Tell us about your store</p>
          <a href="mailto:support@syncifypro.app" style={c.ctaBtn}>Email support@syncifypro.app</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
