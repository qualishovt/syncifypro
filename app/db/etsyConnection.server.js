/**
 * db/etsyConnection.server.js
 *
 * Persistence for the Etsy OAuth connection (tokens per shop) and the temporary
 * handshake state that bridges the authorize redirect and the callback.
 */

import db from "../db.server.js";

export async function getEtsyConnection(shop) {
  return db.etsyConnection.findUnique({ where: { shop } });
}

export async function saveEtsyConnection({ shop, keystring, accessToken, refreshToken, expiresAt, etsyShopId, etsyShopName }) {
  const data = { keystring, accessToken, refreshToken, expiresAt, etsyShopId, etsyShopName };
  return db.etsyConnection.upsert({ where: { shop }, update: data, create: { shop, ...data } });
}

export async function deleteEtsyConnection(shop) {
  await db.etsyConnection.deleteMany({ where: { shop } });
}

// ─── OAuth handshake state ──────────────────────────────────────────────────────

export async function saveOAuthState({ state, shop, keystring, codeVerifier, redirectUri }) {
  return db.migrationOAuthState.create({ data: { state, shop, keystring, codeVerifier, redirectUri } });
}

export async function takeOAuthState(state) {
  const row = await db.migrationOAuthState.findUnique({ where: { state } });
  if (row) await db.migrationOAuthState.deleteMany({ where: { state } });
  return row;
}
