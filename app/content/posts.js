/**
 * content/posts.js — the blog.
 *
 * Same block format as content/docs.js. Dates are fixed strings (not generated)
 * so a post's date never shifts when the page is rebuilt.
 */

export const POSTS = [
  {
    slug: "bulk-price-change-shopify",
    title: "How to change 5,000 Shopify prices in ten minutes",
    date: "2026-08-20",
    readingTime: "4 min read",
    excerpt: "A sale, a supplier increase, a currency swing — the fastest safe way to move a lot of prices at once.",
    body: [
      ["p", "Shopify's admin is built for editing one product at a time. That's fine until a supplier raises prices across a brand and you need to move 5,000 of them before the weekend. Here's the loop that takes ten minutes and, more importantly, is reversible."],
      ["h2", "1. Export only what you're changing"],
      ["p", "Filter the export to the vendor and take three columns: Handle, Title and Price. Title is only there so you can sanity-check what you're looking at — you'll delete it before importing."],
      ["h2", "2. Do the maths in the spreadsheet"],
      ["p", "Add a working column with your new price. For a 7% increase rounded to two decimals:"],
      ["code", "=ROUND(C2 * 1.07, 2)"],
      ["p", "Fill it down, then copy the whole column and paste it back over Price as values. Formulas are for working, values are for importing."],
      ["h2", "3. Trim the file"],
      ["p", "Delete the Title and working columns. You're left with Handle and Price — the identifier and the one field you changed. Everything you leave out stays exactly as it is in Shopify."],
      ["h2", "4. Preview, then run"],
      ["p", "Drop the file back into the app. The preview tells you how many products will be updated before anything is written. If that number is not the number you expected, stop and look at the file."],
      ["note", "Keep the original export. If the change turns out wrong, importing that file puts the old prices back — the same loop, in reverse."],
      ["h2", "Why not a bulk editor?"],
      ["p", "Shopify's bulk editor is good for a screenful of products. Past that you're scrolling and hoping. A spreadsheet gives you formulas, find-and-replace, a second pair of eyes before you commit, and a file you can keep as a record of what changed."],
    ],
  },
  {
    slug: "woocommerce-to-shopify-without-losing-seo",
    title: "Moving from WooCommerce to Shopify without losing your SEO",
    date: "2026-08-15",
    readingTime: "5 min read",
    excerpt: "The catalog is the easy part. Redirects are what decide whether your traffic survives the switch.",
    body: [
      ["p", "Most migration guides stop at \"your products are in Shopify\". That's the half that's easy to see. The half that decides your next quarter is whether the URLs people already link to still work."],
      ["h2", "Why URLs break"],
      ["p", "WooCommerce and Shopify structure URLs differently. A product at /shop/blue-linen-shirt/ becomes /products/blue-linen-shirt, and a category at /product-category/shirts/ becomes /collections/shirts. Every old link — Google's index, other people's blog posts, your own newsletters — points at a page that no longer exists."],
      ["h2", "What a redirect does"],
      ["p", "A 301 redirect tells search engines the page moved permanently and passes on most of its ranking. Without it you keep the product but lose its position; with it, visitors land where they expect and your rankings carry across."],
      ["h2", "Doing it in bulk"],
      ["p", "Writing redirects by hand is fine for ten products and impossible for a thousand. When SyncifyPro migrates a WooCommerce store it generates a Redirects sheet alongside the catalog: the old path in one column, the new handle in the other, one row per product and category. It imports with everything else."],
      ["h2", "A sensible order"],
      ["steps", [
        "Migrate into Shopify while the old store is still live.",
        "Check a sample of products, collections and customers.",
        "Import the redirects.",
        "Switch DNS.",
        "Watch Search Console for 404s over the next fortnight and add any stragglers by hand.",
      ]],
      ["note", "Keep the old store reachable for a few weeks if you can. It's the quickest way to check a product's original data when something looks off."],
    ],
  },
  {
    slug: "automatic-shopify-backups",
    title: "Automatic Shopify backups with scheduled exports",
    date: "2026-08-08",
    readingTime: "3 min read",
    excerpt: "Shopify keeps your store running; it doesn't keep yesterday's version of your catalog. That part is on you.",
    body: [
      ["p", "Shopify is very good at not losing your store. It's not a time machine: if an app rewrites 4,000 product descriptions this morning, there's no button that puts last night's version back. A scheduled export is that button."],
      ["h2", "What to back up"],
      ["ul", [
        "Products — the one everyone regrets not having.",
        "Collections, including the rules behind smart collections.",
        "Customers, if your marketing depends on them.",
        "Metafields, which are easy to overwrite and painful to reconstruct.",
      ]],
      ["h2", "A schedule that's enough"],
      ["p", "Daily is plenty for most stores; hourly if you're running frequent automated updates. Send it somewhere that isn't your laptop — Google Drive or an S3 bucket both work, and both keep the file version history that makes a backup worth having."],
      ["h2", "Test the restore, not the backup"],
      ["p", "A backup you've never restored is a guess. Once, take yesterday's file, change one product in it, and import it back. Now you know the loop works and roughly how long it takes — which is exactly what you want to know on the day something goes wrong."],
      ["note", "Set the file retention in Settings to match how far back you'd realistically want to go. Keeping every export forever isn't useful; keeping the last month usually is."],
    ],
  },
  {
    slug: "metafields-in-bulk",
    title: "Editing Shopify metafields in bulk without touching the API",
    date: "2026-07-30",
    readingTime: "4 min read",
    excerpt: "Metafields are where the interesting product data lives — and the admin is the slowest way to edit them.",
    body: [
      ["p", "Metafields hold the things Shopify's standard fields don't: materials, care instructions, sizing charts, spec sheets, whatever your theme reads. They're also where a catalog quietly becomes inconsistent, because each one is edited by hand, one product at a time."],
      ["h2", "They export like any other column"],
      ["p", "Export Products with metafields included and each definition becomes its own column, with the value in the cell. From there it's a spreadsheet problem: sort by the column to find the blanks, use find-and-replace to standardise \"100% cotton\" against \"Cotton 100%\", fill a whole category in one drag."],
      ["h2", "Types still matter"],
      ["p", "A metafield has a type, and the value has to match it. Numbers must be numbers, dates must be dates, and a list type expects the format Shopify defines. If a value doesn't fit, the import reports that row rather than writing something broken — check the results file."],
      ["h2", "Metaobjects too"],
      ["p", "Metaobjects — reusable structured records that products point at — export and import the same way. Editing a size chart once and having it apply everywhere beats editing it on eighty products."],
      ["note", "Export a couple of products first to see the exact column names for your definitions. Those names are what the import matches on."],
    ],
  },
];

export function getPost(slug) {
  return POSTS.find((p) => p.slug === slug) ?? null;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}
