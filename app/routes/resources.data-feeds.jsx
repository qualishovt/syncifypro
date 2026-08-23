/** routes/resources/data-feeds — scheduled product feeds. */

import { SiteHeader, SiteFooter, Blocks, THEME_CSS, THEME_BOOT, c } from "../components/SiteChrome.jsx";

export const meta = () => [
  { title: "Shopify data feeds — SyncifyPro" },
  { name: "description", content: "Publish scheduled product feeds from Shopify — Google Shopping, XML, CSV or JSON — delivered to FTP, S3, Drive or email." },
];

const BODY = [
  ["p", "A data feed is an export that runs on a schedule and lands somewhere a machine can read it: a shopping channel, a marketplace, a warehouse system, a BI tool. Same export engine, same filters — just repeating, and delivered."],
  ["h2", "What you can publish"],
  ["ul", [
    "Google Shopping feed — product fields in the shape Google Merchant Center expects.",
    "XML — for channels and systems that read a structured feed.",
    "JSON — for anything you are wiring up yourself.",
    "CSV or Excel — for partners and internal reporting.",
  ]],
  ["h2", "Setting one up"],
  ["steps", [
    "Build the export you want: pick the data type, filter it, and choose the columns the receiving system needs.",
    "Run it once and open the file. Feeds fail on small mismatches — check it before automating it.",
    "Save it as a schedule and pick the frequency: hourly for stock, daily for catalog, weekly for reporting.",
    "Choose the destination — FTP/SFTP, Amazon S3, Google Drive, Google Sheets or email.",
  ]],
  ["h2", "Keeping a feed honest"],
  ["ul", [
    "Filter to the products you actually want listed — usually Active status, and in stock.",
    "Include the identifiers the channel matches on (SKU, barcode, MPN) or your items will not be recognised.",
    "Match the refresh rate to how fast the data changes: hourly stock, daily prices.",
    "Watch the job history. A feed that silently stopped updating is worse than no feed.",
  ]],
  ["note", "Every scheduled run keeps its own file and results, so when a channel complains about last Tuesday's feed you can open exactly what was sent."],
  ["h2", "Feeding a warehouse or ERP"],
  ["p", "The same mechanism works in reverse: a scheduled import can pick a file up from FTP or S3 on a timetable, so a supplier's nightly stock file becomes tonight's inventory update without anyone touching it."],
];

export default function DataFeeds() {
  return (
    <div style={c.root}>
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <SiteHeader />
      <main style={c.narrow}>
        <a href="/resources" style={c.back}>← Resources</a>
        <p style={c.kicker}>Data feeds</p>
        <h1 style={c.h1}>Scheduled product feeds from your store</h1>
        <p style={c.lede}>Publish your catalog on a timetable, in the format the receiving system wants.</p>
        <Blocks blocks={BODY} />
        <div style={c.cta}>
          <p style={c.ctaTitle}>Set up your first feed</p>
          <a href="/new#install" style={c.ctaBtn}>Install SyncifyPro</a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
