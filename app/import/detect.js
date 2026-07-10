/**
 * import/detect.js
 *
 * Entity auto-detection — the Matrixify "just drop the file" behaviour. Instead
 * of making the merchant pick "products" from a dropdown, we look at the file's
 * header row and figure out which entity it is.
 *
 * How: every entity has a reverse header map (humanized label → snake_case key)
 * from headers.js. For a given file we count how many of the file's headers a
 * given entity *recognizes*. The entity that explains the most of the file's
 * columns is the match — a redirects file ("Path", "Redirect to") is explained
 * almost entirely by the redirects entity but barely by products, while a
 * products file ("Variant SKU", "Body HTML") is the reverse.
 *
 * Generic labels that collide across entities ("ID", "Command", "Tags") don't
 * decide anything on their own — they're recognized by everyone, so they cancel
 * out and the distinctive columns break the tie. Ratio (recognized / entity
 * size) is the tiebreak so a slim entity that matches exactly isn't beaten by a
 * broad entity that happens to recognize a couple of shared columns.
 */

import { reverseHeaderMap } from "./headers.js";
import { FIELDS_BY_ENTITY } from "../export/fieldLists.js";

/**
 * Entities we can actually import right now (have a validator + writer wired in
 * importJob.js). Detection still *reports* any entity so the UI can say
 * "detected Draft Orders — not yet importable", but supported ones are ranked
 * first on ties so a shared-header file leans toward something we can act on.
 */
export const SUPPORTED_ENTITIES = ["products", "orders", "customers", "redirects", "collections", "discounts"];

/** Headers so generic they appear on nearly every entity — poor discriminators. */
const GENERIC_HEADERS = new Set(["ID", "Command", "Top Row", "Row #", "Row Number"]);

/**
 * Matrixify names each sheet after its entity ("Products", "Customers", "Smart
 * Collections"). Map a sheet name to an entity slug so a multi-sheet workbook
 * routes by sheet name, falling back to header detection when the name is
 * unfamiliar. Normalizes case/spacing and accepts singular or plural.
 */
const NAME_ALIASES = {
  product: "products", products: "products",
  order: "orders", orders: "orders",
  customer: "customers", customers: "customers",
  redirect: "redirects", redirects: "redirects", "url redirect": "redirects", "url redirects": "redirects",
  collection: "collections", collections: "collections",
  "smart collection": "smart_collections", "smart collections": "smart_collections",
  "custom collection": "custom_collections", "custom collections": "custom_collections",
  discount: "discounts", discounts: "discounts",
  page: "pages", pages: "pages",
  blog: "blogs", blogs: "blogs",
  article: "articles", articles: "articles", "blog post": "articles", "blog posts": "articles",
  company: "companies", companies: "companies",
  "draft order": "draft_orders", "draft orders": "draft_orders",
  file: "files", files: "files",
  page_content: "content",
};

/**
 * @param {string} name - a sheet name
 * @returns {string|null} entity slug, or null if the name isn't recognized
 */
export function entityFromSheetName(name) {
  const key = String(name ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!key) return null;
  if (NAME_ALIASES[key]) return NAME_ALIASES[key];
  // Also accept an exact entity-slug spelling ("smart_collections").
  const slug = key.replace(/\s+/g, "_");
  return FIELDS_BY_ENTITY[slug] ? slug : null;
}

/**
 * Score one entity against a file's header list.
 *
 * @param {string} entity
 * @param {string[]} headers - raw headers from the parsed file
 * @returns {{ entity: string, recognized: number, distinctive: number, ratio: number }}
 */
function scoreEntity(entity, headers) {
  // Some entities have colliding humanized labels, which makes their reverse
  // map throw. Those aren't importable anyway — treat them as un-scorable
  // rather than letting one bad entity break detection for the whole file.
  let map;
  try {
    map = reverseHeaderMap(entity);
  } catch {
    return { entity, recognized: 0, distinctive: 0, ratio: 0 };
  }
  let recognized = 0;
  let distinctive = 0;
  for (const h of headers) {
    if (!map.has(h)) continue;
    recognized += 1;
    if (!GENERIC_HEADERS.has(h)) distinctive += 1;
  }
  const size = FIELDS_BY_ENTITY[entity].length;
  return { entity, recognized, distinctive, ratio: recognized / size };
}

/**
 * Detect the most likely entity for a parsed file.
 *
 * @param {string[]} headers - the file's header row (humanized labels)
 * @returns {{
 *   entity: string|null,     // best guess, or null if nothing matched
 *   supported: boolean,      // whether that entity has an import writer
 *   confidence: "high"|"low"|"none",
 *   scores: Array<{entity: string, recognized: number, distinctive: number, ratio: number}>,
 * }}
 */
export function detectEntity(headers) {
  if (!headers || headers.length === 0) {
    return { entity: null, supported: false, confidence: "none", scores: [] };
  }

  const scores = Object.keys(FIELDS_BY_ENTITY)
    .map((entity) => scoreEntity(entity, headers))
    .filter((s) => s.recognized > 0)
    // Rank: most distinctive columns first, then broadest recognition, then
    // best fit ratio, then supported entities ahead of unsupported ones.
    .sort((a, b) => {
      if (b.distinctive !== a.distinctive) return b.distinctive - a.distinctive;
      if (b.recognized !== a.recognized) return b.recognized - a.recognized;
      if (b.ratio !== a.ratio) return b.ratio - a.ratio;
      const aSup = SUPPORTED_ENTITIES.includes(a.entity) ? 1 : 0;
      const bSup = SUPPORTED_ENTITIES.includes(b.entity) ? 1 : 0;
      return bSup - aSup;
    });

  const best = scores[0];
  if (!best) {
    return { entity: null, supported: false, confidence: "none", scores: [] };
  }

  // Confidence: at least two distinctive (non-generic) columns matched, and the
  // runner-up doesn't tie it on distinctive count (an ambiguous file is low-confidence).
  const runnerUp = scores[1];
  const clearWinner = !runnerUp || best.distinctive > runnerUp.distinctive;
  const confidence = best.distinctive >= 2 && clearWinner ? "high" : "low";

  return {
    entity: best.entity,
    supported: SUPPORTED_ENTITIES.includes(best.entity),
    confidence,
    scores: scores.slice(0, 5),
  };
}
