// Run each NEW entity extractor against the live store through the dev
// server's GraphiQL proxy (a valid, auto-refreshed token). The proxy stands
// in for the `admin` client the extractors expect.
import { readFileSync } from "node:fs";

const log = readFileSync(process.env.DEV_LOG, "utf16le");
const m = log.match(/localhost:(\d+)\/graphiql\?key=([a-f0-9]+)/);
if (!m) throw new Error("no graphiql url in dev log");
const URL_ = `http://localhost:${m[1]}/graphiql/graphql.json?key=${m[2]}`;

const admin = {
  async graphql(query, opts) {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: opts?.variables ?? {} }),
    });
    const json = await res.json();
    return { json: async () => json };
  },
};

const ENTITIES = {
  inventory: "../app/export/entities/inventory.js#extractInventory",
  selling_plans: "../app/export/entities/sellingPlans.js#extractSellingPlans",
  markets: "../app/export/entities/markets.js#extractMarkets",
  delivery_profiles: "../app/export/entities/deliveryProfiles.js#extractDeliveryProfiles",
  segments: "../app/export/entities/segments.js#extractSegments",
  store_credit: "../app/export/entities/storeCredit.js#extractStoreCredit",
  product_media: "../app/export/entities/productMedia.js#extractProductMedia",
};

const { FIELDS_BY_ENTITY } = await import("../app/export/fieldLists.js");

let fails = 0;
for (const [name, spec] of Object.entries(ENTITIES)) {
  const [path, fn] = spec.split("#");
  try {
    const mod = await import(path);
    const rows = await mod[fn](admin, {});
    // Every key an extractor emits must exist in the entity's field list,
    // or the column would vanish from a column-selected export.
    const declared = new Set(FIELDS_BY_ENTITY[name]);
    const emitted = new Set(rows.flatMap((r) => Object.keys(r)));
    const undeclared = [...emitted].filter((k) => !declared.has(k));
    if (undeclared.length) throw new Error(`emits undeclared columns: ${undeclared.join(", ")}`);
    console.log(`OK   ${name.padEnd(18)} ${rows.length} row(s)${rows[0] ? " | " + JSON.stringify(rows[0]).slice(0, 120) : ""}`);
  } catch (e) {
    fails++;
    console.log(`FAIL ${name.padEnd(18)} ${e.message.replace(/\s+/g, " ").slice(0, 180)}`);
  }
}
console.log(fails ? `\n${fails} extractor(s) failed` : "\nall extractors OK");
process.exit(fails ? 1 : 0);
