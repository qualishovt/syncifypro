/**
 * content/tutorials.js — task-shaped walkthroughs ("how do I do X?").
 *
 * Guides (content/docs.js) explain how a feature works; tutorials walk through
 * one concrete job start to finish. Same block format.
 */

export const TUTORIALS = [
  {
    slug: "change-prices-in-bulk",
    title: "Change prices in bulk",
    minutes: "5 min",
    summary: "Raise, cut or recalculate prices across a vendor, a collection or the whole catalog.",
    body: [
      ["p", "The safest bulk price change is the smallest possible file: the identifier column and the price column, nothing else."],
      ["steps", [
        "Export Products. Filter to what you're changing — vendor, tag, or product status.",
        "Choose the columns Handle, Title, Price. (Title is only there so you can check the file by eye.)",
        "Open the file and add a working column: =ROUND(D2 * 1.07, 2) for a 7% rise.",
        "Copy the working column and paste it over Price as values.",
        "Delete the Title and working columns, leaving Handle and Price.",
        "Import the file and read the preview: the update count should match what you filtered.",
      ]],
      ["note", "Keep the original export. Re-importing it restores the old prices — that is your undo."],
      ["h2", "Variant prices"],
      ["p", "Variants are their own rows under the product. Export with variant columns, change the price on the variant rows, and keep the Handle on every row so each variant stays attached to its product."],
      ["h2", "Compare-at prices for a sale"],
      ["p", "To run a sale, copy the current Price into Compare At Price, then write the sale price into Price. When the sale ends, import a file that moves Compare At Price back into Price and blanks the compare-at column."],
    ],
  },
  {
    slug: "bulk-edit-tags",
    title: "Add, remove or replace tags",
    minutes: "4 min",
    summary: "Tags drive collections, filters and automations — and they are replaced wholesale on import.",
    body: [
      ["note", "Tags are replaced, not appended. Whatever is in the cell becomes the product's complete tag list, so always start from an export that already contains the current tags."],
      ["h2", "Adding a tag to a selection"],
      ["steps", [
        "Export Products with Handle and Tags, filtered to the products you're tagging.",
        "In a working column: =IF(ISNUMBER(SEARCH(\"sale\",C2)), C2, C2 & \", sale\") so you don't double-add.",
        "Paste as values over Tags, delete the working column, import.",
      ]],
      ["h2", "Removing a tag"],
      ["p", "Use find-and-replace on the Tags column: replace \", sale\" and \"sale, \" with nothing, then tidy any cell where the tag was the only one. Import the result."],
      ["h2", "Renaming a tag everywhere"],
      ["p", "Export filtered by the old tag, find-and-replace the old name with the new one, import. Smart collections that reference the tag pick up the change automatically."],
    ],
  },
  {
    slug: "update-inventory",
    title: "Update inventory across locations",
    minutes: "4 min",
    summary: "Set stock levels from a supplier file, per location, without touching anything else.",
    body: [
      ["p", "Inventory lives per location, so an inventory file needs three things: which variant, which location, and the quantity."],
      ["steps", [
        "Export Inventory. The file lists each variant with a column per location.",
        "Match your supplier's SKUs against the SKU column — VLOOKUP or XLOOKUP works well here.",
        "Write the new quantities into the location column you're updating.",
        "Delete the location columns you are not changing, then import.",
      ]],
      ["note", "Leaving a location out of the file leaves that location's stock untouched. That is usually what you want when only one warehouse is being counted."],
      ["h2", "Doing it every night"],
      ["p", "If the supplier posts a file to FTP on a schedule, set up a scheduled import against that server instead of doing this by hand. See the scheduling guide."],
    ],
  },
  {
    slug: "delete-products-safely",
    title: "Delete products safely",
    minutes: "3 min",
    summary: "Bulk deletion is the one operation with no undo — here's how to make it reversible anyway.",
    body: [
      ["note", "Before any delete: export the products you're about to remove, with every column. That file is the only way back."],
      ["steps", [
        "Export the products you intend to delete — filter by status Archived, by tag, or by vendor.",
        "Save that export somewhere safe. This is your backup.",
        "Take a copy, keep only the Handle column, and add a Command column with DELETE in every row.",
        "Import it. The preview will show the delete count — check it before confirming.",
      ]],
      ["h2", "If you delete the wrong thing"],
      ["p", "Import the backup file with Command set to NEW. Product IDs will differ and the original URLs won't come back on their own, so add redirects if the products were indexed."],
      ["h2", "Archive instead"],
      ["p", "Often the goal is \"hide it\", not \"destroy it\". Setting Status to ARCHIVED does that and is completely reversible."],
    ],
  },
  {
    slug: "export-orders-for-accounting",
    title: "Export orders for your accountant",
    minutes: "4 min",
    summary: "A monthly order export, filtered to the period, delivered automatically.",
    body: [
      ["steps", [
        "Export Orders with the date filter set to the period you need.",
        "Pick the columns your accountant actually uses: order name, date, customer email, line items, taxes, totals, financial status.",
        "Export as Excel — one sheet, easy to open — or CSV if their software imports that.",
        "Once the file looks right, save it as a schedule set to Monthly and deliver it to their email.",
      ]],
      ["note", "Order exports include Protected Customer Data. Send them only to people who need them, and set a file retention period that matches your policy."],
      ["h2", "Refunds and partial payments"],
      ["p", "Financial status distinguishes paid, partially refunded and refunded orders. Include that column, or the totals won't reconcile."],
    ],
  },
  {
    slug: "fix-a-failed-import",
    title: "Fix a failed import with the results file",
    minutes: "3 min",
    summary: "Every job produces a results workbook that tells you exactly which rows failed and why.",
    body: [
      ["p", "A partly-failed import is normal — a handful of rows usually have a bad value. You don't need to redo the whole file."],
      ["steps", [
        "Open the job under Activity and download the results file.",
        "Filter to rows with a failure reason. The reason sits next to the row that caused it.",
        "Fix those rows in place.",
        "Delete every row that succeeded, so the file contains only the fixes.",
        "Import the smaller file.",
      ]],
      ["h2", "Reading the reasons"],
      ["p", "Most messages come straight from Shopify and name the field. \"Handle has already been taken\" means a NEW row hit an existing product; \"Path has already been taken\" means a redirect already exists for that path. The troubleshooting guide covers the frequent ones."],
    ],
  },
  {
    slug: "clean-up-a-messy-catalog",
    title: "Clean up a messy catalog",
    minutes: "6 min",
    summary: "Standardise vendors, product types and titles that grew inconsistent over the years.",
    body: [
      ["p", "Inconsistency is invisible in the admin, one product at a time, and obvious the moment the catalog is in a spreadsheet."],
      ["h2", "Find the inconsistencies"],
      ["steps", [
        "Export Products with Handle, Title, Vendor, Type and Tags.",
        "Build a pivot table (or just sort) on Vendor. \"Acme\", \"ACME\" and \"Acme Ltd\" will jump out.",
        "Do the same for Type and for the first word of Title.",
      ]],
      ["h2", "Fix and import back"],
      ["p", "Standardise the values in the sheet, delete the columns you didn't touch, and import. One file can fix thousands of records that would take days in the admin."],
      ["note", "Do vendors first, then types, then tags. Changing one thing at a time makes it obvious which import caused a surprise."],
    ],
  },
];

export function getTutorial(slug) {
  return TUTORIALS.find((t) => t.slug === slug) ?? null;
}
