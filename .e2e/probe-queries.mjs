// Validate the exact GraphQL shapes for the new entities against the live
// store, through the dev server's GraphiQL proxy (valid refreshed token).
import { readFileSync } from "node:fs";

const KEY = "0632973fff7d792c9866bbf0f78206d1e375cb547bafa2e4f5bedb1dc3b81dc7";
const URL_ = `http://localhost:3457/graphiql/graphql.json?key=${KEY}`;

const Q = {
  inventory: `{ inventoryItems(first: 2) { pageInfo { hasNextPage endCursor } nodes {
      id sku tracked requiresShipping countryCodeOfOrigin harmonizedSystemCode
      unitCost { amount currencyCode }
      measurement { weight { value unit } }
      variant { id title sku displayName product { id title handle } }
      inventoryLevels(first: 5) { nodes { id location { id name } quantities(names: ["available","on_hand","committed","incoming"]) { name quantity } } }
    } } }`,

  selling_plans: `{ sellingPlanGroups(first: 2) { pageInfo { hasNextPage endCursor } nodes {
      id name merchantCode description summary options position appId createdAt
      productsCount { count } productVariantsCount { count }
      sellingPlans(first: 10) { nodes { id name description options category
        billingPolicy { ... on SellingPlanRecurringBillingPolicy { interval intervalCount } }
        deliveryPolicy { ... on SellingPlanRecurringDeliveryPolicy { interval intervalCount } }
      } }
    } } }`,

  markets: `{ markets(first: 5) { pageInfo { hasNextPage endCursor } nodes {
      id name handle status
    } } }`,

  delivery_profiles: `{ deliveryProfiles(first: 5) { pageInfo { hasNextPage endCursor } nodes {
      id name default
      activeMethodDefinitionsCount locationsWithoutRatesCount originLocationCount
      productVariantsCountV2 { count }
    } } }`,

  segments: `{ segments(first: 5) { pageInfo { hasNextPage endCursor } nodes {
      id name query creationDate lastEditDate
    } } }`,

  subscriptions: `{ subscriptionContracts(first: 3) { pageInfo { hasNextPage endCursor } nodes {
      id status createdAt nextBillingDate currencyCode revisionId
      customer { id email displayName }
      deliveryPolicy { interval intervalCount }
      billingPolicy { interval intervalCount maxCycles minCycles }
      lines(first: 5) { nodes { id title quantity currentPrice { amount currencyCode } sku variantTitle } }
    } } }`,

  store_credit: `{ customers(first: 3) { pageInfo { hasNextPage endCursor } nodes {
      id email displayName
      storeCreditAccounts(first: 5) { nodes { id balance { amount currencyCode } } }
    } } }`,

  product_media: `{ products(first: 2) { pageInfo { hasNextPage endCursor } nodes {
      id handle title
      media(first: 10) { nodes { id mediaContentType alt status
        ... on MediaImage { image { url width height } }
        ... on Video { sources { url format mimeType } }
        ... on ExternalVideo { embedUrl host }
        ... on Model3d { sources { url format mimeType } }
      } }
    } } }`,
};

for (const [name, query] of Object.entries(Q)) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    console.log(`✖ ${name}: ${json.errors.map((e) => e.message).join(" | ").slice(0, 240)}`);
  } else {
    const root = Object.values(json.data)[0];
    const n = root?.nodes?.length ?? 0;
    console.log(`✔ ${name}: ok (${n} node(s))`);
    if (n) console.log(`   sample: ${JSON.stringify(root.nodes[0]).slice(0, 260)}`);
  }
}
