/**
 * utils/crypto.server.test.js
 *
 * At-rest credential encryption: round-trip, tamper detection, legacy
 * plaintext passthrough, and unique ciphertexts per call (random IV).
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.CREDENTIALS_ENCRYPTION_KEY = "test-key-for-unit-tests";
const { encryptSecret, decryptSecret } = await import("./crypto.server.js");

test("secrets round-trip", () => {
  const secrets = ["hunter2", "p@ss with spaces & symbols!", "🔑 unicode", "x".repeat(500)];
  for (const s of secrets) {
    const stored = encryptSecret(s);
    assert.notEqual(stored, s);
    assert.ok(stored.startsWith("enc1:"));
    assert.equal(decryptSecret(stored), s);
  }
});

test("random IV: same plaintext encrypts differently each time", () => {
  assert.notEqual(encryptSecret("same"), encryptSecret("same"));
});

test("null/empty pass through both ways", () => {
  assert.equal(encryptSecret(null), null);
  assert.equal(encryptSecret(""), "");
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), "");
});

test("legacy plaintext (no prefix) passes through decrypt unchanged", () => {
  assert.equal(decryptSecret("old-plaintext-password"), "old-plaintext-password");
});

test("tampered ciphertext throws instead of returning garbage", () => {
  const stored = encryptSecret("secret");
  const raw = Buffer.from(stored.slice("enc1:".length), "base64");
  raw[raw.length - 1] ^= 0xff; // flip a ciphertext bit
  const tampered = "enc1:" + raw.toString("base64");
  assert.throws(() => decryptSecret(tampered));
});
