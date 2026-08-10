/**
 * utils/crypto.server.js
 *
 * At-rest encryption for stored credentials (saved import servers'
 * passwords / S3 secrets). AES-256-GCM — authenticated, so a tampered or
 * wrong-key value fails loudly instead of decrypting to garbage.
 *
 * Key: sha256 of CREDENTIALS_ENCRYPTION_KEY, falling back to
 * SHOPIFY_API_SECRET (which the Shopify CLI injects in dev and hosts set
 * in production). Set the dedicated variable before rotating the API
 * secret, or stored credentials become undecryptable.
 *
 * Format: "enc1:" + base64(iv[12] ‖ authTag[16] ‖ ciphertext). Values
 * without the prefix are passed through as legacy plaintext, so rows
 * saved before encryption shipped keep working.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc1:";

function encryptionKey() {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("Can't store credentials: set CREDENTIALS_ENCRYPTION_KEY (or SHOPIFY_API_SECRET) in the environment.");
  }
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

/** Encrypt a secret for storage. Null/empty values pass through unchanged. */
export function encryptSecret(plain) {
  if (plain == null || plain === "") return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/**
 * Decrypt a stored secret. Values without the "enc1:" prefix (legacy
 * plaintext, null, empty) pass through unchanged. Throws on tampering or
 * a wrong key.
 */
export function decryptSecret(stored) {
  if (stored == null || stored === "" || !String(stored).startsWith(PREFIX)) return stored;
  const raw = Buffer.from(String(stored).slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
