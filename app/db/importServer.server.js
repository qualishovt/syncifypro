/**
 * db/importServer.server.js
 *
 * Saved remote servers for "Import from URL" — FTP/FTPS/SFTP credentials
 * or S3 keys, keyed by shop. When the merchant types a URL like
 * sftp://host/path or s3://bucket/key without inline credentials, the
 * fetcher looks up the matching saved server by protocol + host.
 */

import db from "../db.server.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.server.js";

/** All saved servers for a shop (never returns passwords to the client — see serialize). */
export async function listImportServers(shop) {
  return db.importServer.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
}

/** Client-safe shape: no password/secret. */
export function serializeImportServer(s) {
  return {
    id: s.id,
    label: s.label,
    protocol: s.protocol,
    host: s.host,
    port: s.port,
    username: s.username,
    region: s.region,
  };
}

export async function saveImportServer({ shop, label, protocol, host, port, username, password, region }) {
  return db.importServer.create({
    data: {
      shop,
      label,
      protocol,
      host,
      port: port ?? null,
      username: username || null,
      // Encrypted at rest (AES-256-GCM); decrypted only in findServerForUrl.
      password: password ? encryptSecret(password) : null,
      region: region || null,
    },
  });
}

/**
 * Update a saved server. A blank password means "keep the stored one" —
 * secrets are never sent back to the client, so edits can't resend them.
 */
export async function updateImportServer(shop, id, { label, protocol, host, port, username, password, region }) {
  const existing = await db.importServer.findFirst({ where: { id, shop } });
  if (!existing) return null;
  return db.importServer.update({
    where: { id: existing.id },
    data: {
      label,
      protocol,
      host,
      port: port ?? null,
      username: username || null,
      password: password ? encryptSecret(password) : existing.password,
      region: region || null,
    },
  });
}

export async function deleteImportServer(shop, id) {
  // deleteMany so a forged id from another shop is a no-op, not an error.
  return db.importServer.deleteMany({ where: { id, shop } });
}

/** One saved server by id, with the password DECRYPTED (server-side use only). */
export async function getImportServer(shop, id) {
  const server = await db.importServer.findFirst({ where: { id, shop } });
  if (!server) return null;
  return { ...server, password: decryptSecret(server.password) };
}

/**
 * The saved server matching a URL's protocol + host (ftps falls back to a
 * saved ftp entry for the same host). For s3:// URLs `host` is the bucket.
 */
export async function findServerForUrl(shop, protocol, host) {
  const protocols = protocol === "ftps" ? ["ftps", "ftp"] : [protocol];
  const server = await db.importServer.findFirst({
    where: { shop, protocol: { in: protocols }, host },
    orderBy: { createdAt: "desc" },
  });
  if (!server) return null;
  // Stored encrypted; the fetchers need the plaintext to authenticate.
  // (Legacy pre-encryption rows pass through decryptSecret unchanged.)
  return { ...server, password: decryptSecret(server.password) };
}
