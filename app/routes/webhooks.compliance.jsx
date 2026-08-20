/**
 * routes/webhooks.compliance.jsx — Shopify's mandatory privacy webhooks:
 *   customers/data_request, customers/redact, shop/redact
 * (subscribed via `compliance_topics` in shopify.app*.toml, delivered here).
 *
 * The app keeps no per-customer records of its own — customer fields only
 * ever appear inside export/import files the merchant produced, and those are
 * covered by the shop-level erasure. So:
 *   - customers/data_request → nothing to return beyond what Shopify holds; ack.
 *   - customers/redact       → nothing addressable per customer; ack.
 *   - shop/redact            → 48h after uninstall: delete every file on R2
 *                              and every row for the shop.
 * authenticate.webhook verifies the HMAC; a bad signature is a 401 before we
 * get here. Always answer 200 quickly so Shopify doesn't retry.
 */

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    await redactShop(shop);
  }
  // CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT: acknowledged (see header).
  return new Response();
};

/** Remove everything the app holds for a shop: R2 files first, then rows. */
async function redactShop(shop) {
  try {
    const { eraseAllShopFiles } = await import("../db/cleanup.server.js");
    await eraseAllShopFiles(shop);
  } catch (err) {
    console.error(`shop/redact: file erasure failed for ${shop}: ${err.message}`);
  }
  // Order matters only for readability — no FK constraints between these.
  await db.scheduleRun.deleteMany({ where: { shop } });
  await db.schedule.deleteMany({ where: { shop } });
  await db.bulkExportJob.deleteMany({ where: { shop } });
  await db.bulkImportJob.deleteMany({ where: { shop } });
  await db.exportPreset.deleteMany({ where: { shop } });
  await db.importPreset.deleteMany({ where: { shop } });
  await db.importServer.deleteMany({ where: { shop } });
  await db.migrationConnection.deleteMany({ where: { shop } });
  await db.migrationOAuthState.deleteMany({ where: { shop } });
  await db.etsyConnection.deleteMany({ where: { shop } });
  await db.googleConnection.deleteMany({ where: { shop } });
  await db.appSettings.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });
}
