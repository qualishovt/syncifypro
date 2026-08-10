// Which of the 226 advertised orders columns never appear in real rows?
import { admin } from "./lib.mjs";

const { extractOrders } = await import("../app/export/entities/orders.js");
const { FIELDS_BY_ENTITY } = await import("../app/export/fieldLists.js");

const a = await admin();
const rows = await extractOrders(a, { query: null, fields: undefined, shop: "dataengine.myshopify.com" });
console.log("rows:", rows.length);

const keys = new Set();
for (const r of rows) for (const k of Object.keys(r)) keys.add(k);

const advertised = FIELDS_BY_ENTITY.orders;
console.log("advertised:", advertised.length, "| distinct keys in data:", keys.size);
console.log("advertised but never in rows:", advertised.filter((f) => !keys.has(f)));
console.log("in rows but not advertised:", [...keys].filter((k) => !advertised.includes(k) && k !== "top_row"));
