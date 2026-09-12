/**
 * routes/sitemap[.]xml — the marketing site's sitemap.
 *
 * Generated from the same content modules the pages render from, so a new
 * post, tutorial, doc or migration guide appears here the moment it ships —
 * nothing to remember to update. Only public marketing pages belong here: the
 * embedded app (/app/*), auth and file routes are not indexable and are
 * excluded in robots.txt as well.
 */

import { POSTS } from "../content/posts.js";
import { TUTORIALS } from "../content/tutorials.js";
import { DOCS } from "../content/docs.js";
import { MIGRATION_GUIDES } from "../content/migrationGuides.js";

const SITE = "https://syncifypro.app";

// Static pages, most important first. `changefreq`/`priority` are advisory —
// search engines mostly ignore them, but lastmod is read.
const STATIC = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/resources", priority: "0.8", changefreq: "weekly" },
  { path: "/resources/documentation", priority: "0.8", changefreq: "weekly" },
  { path: "/resources/tutorials", priority: "0.8", changefreq: "weekly" },
  { path: "/resources/migrate", priority: "0.8", changefreq: "monthly" },
  { path: "/resources/data-feeds", priority: "0.6", changefreq: "monthly" },
  { path: "/resources/experts", priority: "0.5", changefreq: "monthly" },
  { path: "/blog", priority: "0.7", changefreq: "weekly" },
  { path: "/changelog", priority: "0.5", changefreq: "weekly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
];

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function url({ path, lastmod, changefreq = "monthly", priority = "0.6" }) {
  return [
    "  <url>",
    `    <loc>${escape(SITE + path)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].filter(Boolean).join("\n");
}

export async function loader() {
  const today = new Date().toISOString().slice(0, 10);

  const entries = [
    ...STATIC.map((p) => url({ ...p, lastmod: today })),
    ...POSTS.map((p) => url({ path: `/blog/${p.slug}`, lastmod: p.date || today, priority: "0.7" })),
    ...TUTORIALS.map((t) => url({ path: `/resources/tutorials/${t.slug}`, lastmod: today, priority: "0.7" })),
    ...DOCS.map((d) => url({ path: `/resources/${d.slug}`, lastmod: today, priority: "0.7" })),
    ...MIGRATION_GUIDES.map((g) => url({ path: `/resources/migrate/${g.slug}`, lastmod: today, priority: "0.7" })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Cheap to generate; let crawlers and the CDN hold it for an hour.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
