import { gql } from "./lib.mjs";
const Q = JSON.parse(process.env.PROBE_JSON);
for (const [name, query] of Object.entries(Q)) {
  try {
    const data = await gql(query);
    const root = Object.values(data)[0];
    const n = root?.nodes?.length ?? 0;
    console.log(`OK   ${name} (${n} node(s)) ${n ? JSON.stringify(root.nodes[0]).slice(0, 200) : ""}`);
  } catch (e) {
    console.log(`ERR  ${name}: ${e.message.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
process.exit(0);
