/**
 * db/migrationConnection.server.js
 *
 * Saved key/secret connections to source platforms (WooCommerce, Magento,
 * BigCommerce, PrestaShop) — one per shop+platform. Persisting them is what
 * makes "Connected" survive a reload and lets a migration re-run without the
 * merchant re-typing keys.
 *
 * Secret fields (the platform's `secret: true` fields) are AES-256-GCM
 * encrypted at rest with the same helpers as ImportServer passwords, and
 * NEVER round-trip to the client: `serialize` returns only which secret
 * fields are set, plus the non-secret ones for prefilling.
 */

import db from "../db.server.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.server.js";
import { getPlatform } from "../migrations/platforms.js";

function secretKeys(platform) {
  return new Set((getPlatform(platform)?.fields ?? []).filter((f) => f.secret).map((f) => f.key));
}

/** Persist (create or replace) a shop's connection to a platform. */
export async function saveMigrationConnection({ shop, platform, creds, label = null }) {
  const secrets = secretKeys(platform);
  const stored = {};
  for (const [k, v] of Object.entries(creds ?? {})) {
    if (v == null || v === "") continue;
    stored[k] = secrets.has(k) ? encryptSecret(String(v)) : String(v);
  }
  return db.migrationConnection.upsert({
    where: { shop_platform: { shop, platform } },
    create: { shop, platform, creds: JSON.stringify(stored), label },
    update: { creds: JSON.stringify(stored), label, connectedAt: new Date() },
  });
}

/** All of a shop's saved connections, decrypted for SERVER use only. */
export async function listMigrationConnections(shop) {
  const rows = await db.migrationConnection.findMany({ where: { shop } });
  return rows.map(decryptRow);
}

/** One saved connection, decrypted for SERVER use only (null if none). */
export async function getMigrationConnection(shop, platform) {
  const row = await db.migrationConnection.findUnique({ where: { shop_platform: { shop, platform } } });
  return row ? decryptRow(row) : null;
}

export async function deleteMigrationConnection(shop, platform) {
  await db.migrationConnection.deleteMany({ where: { shop, platform } });
}

function decryptRow(row) {
  let creds = {};
  try { creds = JSON.parse(row.creds || "{}"); } catch { creds = {}; }
  const secrets = secretKeys(row.platform);
  const out = {};
  for (const [k, v] of Object.entries(creds)) out[k] = secrets.has(k) ? decryptSecret(v) : v;
  return { id: row.id, shop: row.shop, platform: row.platform, label: row.label, connectedAt: row.connectedAt, creds: out };
}

/**
 * Client-safe shape: non-secret fields verbatim (to prefill), secret fields
 * reduced to a boolean "set" marker so the UI can show them as stored
 * without ever holding the value.
 */
export function serializeMigrationConnection(conn) {
  const secrets = secretKeys(conn.platform);
  const fields = {};
  const secretsSet = {};
  for (const [k, v] of Object.entries(conn.creds ?? {})) {
    if (secrets.has(k)) secretsSet[k] = Boolean(v);
    else fields[k] = v;
  }
  return {
    platform: conn.platform,
    label: conn.label,
    connectedAt: conn.connectedAt ? new Date(conn.connectedAt).toISOString() : null,
    fields,
    secretsSet,
  };
}
