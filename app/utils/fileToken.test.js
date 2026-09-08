/**
 * utils/fileToken.test.js — signed download tokens for /files/:token.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.CREDENTIALS_ENCRYPTION_KEY ||= "test-signing-key";

const { signFileToken, verifyFileToken } = await import("./fileToken.server.js");

test("round-trips key, filename, disposition and expiry", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const token = signFileToken({ key: "exports/shop/Products-2026.csv", filename: "Products 2026.csv", expiresAt });
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "URL-safe");
  const claims = verifyFileToken(token);
  assert.equal(claims.key, "exports/shop/Products-2026.csv");
  assert.equal(claims.filename, "Products 2026.csv");
  assert.equal(claims.disposition, "attachment");
  assert.equal(claims.expiresAt.getTime(), Math.floor(expiresAt.getTime() / 1000) * 1000);

  const inline = signFileToken({ key: "k.pdf", filename: "k.pdf", disposition: "inline", expiresAt });
  assert.equal(verifyFileToken(inline).disposition, "inline");
});

test("rejects expired, tampered, and malformed tokens", () => {
  const past = signFileToken({ key: "k", filename: "f", expiresAt: new Date(Date.now() - 1000) });
  assert.equal(verifyFileToken(past), null, "expired");

  const good = signFileToken({ key: "k", filename: "f", expiresAt: new Date(Date.now() + 60_000) });
  const [payload, sig] = good.split(".");
  assert.equal(verifyFileToken(`${payload}.${sig.slice(0, -2)}xx`), null, "bad signature");
  const other = Buffer.from(JSON.stringify({ k: "other", n: "f", d: "a", e: 4102444800 })).toString("base64url");
  assert.equal(verifyFileToken(`${other}.${sig}`), null, "payload swapped");
  assert.equal(verifyFileToken("nonsense"), null);
  assert.equal(verifyFileToken(""), null);
  assert.equal(verifyFileToken(undefined), null);
});
