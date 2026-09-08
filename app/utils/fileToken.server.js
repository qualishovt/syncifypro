/**
 * utils/fileToken.server.js
 *
 * Signed, expiring download tokens for /files/:token — the app-domain
 * download link that replaced direct R2 pre-signed URLs.
 *
 * Why: a pre-signed URL points the browser at *.r2.cloudflarestorage.com,
 * and some networks (Shopify's app-review environment among them) reset
 * that connection, so "Download" showed a browser error page inside the
 * embedded app. Serving files through the app's own origin removes the
 * third-party host entirely; the token carries what the R2 URL used to:
 * object key, download filename, disposition and expiry, HMAC-signed so it
 * can't be forged or altered.
 *
 * Token: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function signingKey() {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("Can't sign download links: set CREDENTIALS_ENCRYPTION_KEY (or SHOPIFY_API_SECRET).");
  return secret;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (payload) => createHmac("sha256", signingKey()).update(payload).digest();

/**
 * @param {{ key: string, filename: string, disposition?: "attachment"|"inline", expiresAt: Date|number }} claims
 * @returns {string} token
 */
export function signFileToken({ key, filename, disposition = "attachment", expiresAt }) {
  const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
  const payload = b64u(JSON.stringify({ k: key, n: filename, d: disposition === "inline" ? "i" : "a", e: exp }));
  return `${payload}.${b64u(hmac(payload))}`;
}

/**
 * Verify a token. Returns the claims, or null when the signature is wrong,
 * the token is malformed, or it has expired.
 * @returns {{ key: string, filename: string, disposition: "attachment"|"inline", expiresAt: Date } | null}
 */
export function verifyFileToken(token, now = Date.now()) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected;
  try {
    expected = hmac(payload);
  } catch {
    return null;
  }
  let given;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims.k !== "string" || !claims.k || typeof claims.n !== "string") return null;
  if (!Number.isFinite(claims.e) || claims.e * 1000 < now) return null;
  return {
    key: claims.k,
    filename: claims.n,
    disposition: claims.d === "i" ? "inline" : "attachment",
    expiresAt: new Date(claims.e * 1000),
  };
}
