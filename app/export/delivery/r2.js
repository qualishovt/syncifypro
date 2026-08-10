/**
 * export/delivery/r2.js
 *
 * Uploads an export file buffer to Cloudflare R2 (S3-compatible)
 * and returns a pre-signed URL that expires after a set duration.
 *
 * Uses @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner —
 * both work against R2 by pointing at R2's S3-compatible endpoint.
 *
 * Required environment variables (.env):
 *   R2_ACCOUNT_ID        — Cloudflare account ID (32-char hex)
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret key
 *   R2_BUCKET_NAME       — bucket name (e.g. "syncifypro")
 *
 * Install deps:
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Signed URL expiry in seconds — 1 hour */
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60;

const R2_ERROR_CODES = new Set([
  "AccessDenied", "NoSuchBucket", "InvalidAccessKeyId", "SignatureDoesNotMatch",
]);

/**
 * Turn a raw S3/R2 SDK error into an actionable message pointing at the likely
 * misconfiguration. Returns null when the error isn't a recognizable R2/S3
 * error, so callers can fall back to the original message.
 *
 * @param {any} err
 * @param {string} [bucket]
 * @returns {string|null}
 */
export function describeR2Error(err, bucket) {
  const name = err?.name ?? err?.Code;
  if (!name || (!R2_ERROR_CODES.has(name) && !err?.$metadata)) return null;
  const where = bucket ? ` for bucket "${bucket}"` : "";
  const base = `R2 upload failed (${name})${where}`;
  switch (name) {
    case "AccessDenied":
      return `${base}: the R2 API token can't write here. Check that R2_BUCKET_NAME matches an existing bucket and the token has "Object Read & Write" access to it.`;
    case "NoSuchBucket":
      return `${base}: bucket not found — check R2_BUCKET_NAME.`;
    case "InvalidAccessKeyId":
      return `${base}: R2_ACCESS_KEY_ID is invalid.`;
    case "SignatureDoesNotMatch":
      return `${base}: R2_SECRET_ACCESS_KEY is invalid.`;
    default:
      return `${base}: ${err?.message ?? "unknown error"}`;
  }
}

/** How long to keep export files in R2 before cleanup (milliseconds) — 7 days */
export const FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId)                        throw new Error("R2_ACCOUNT_ID is not set");
  if (!process.env.R2_ACCESS_KEY_ID)     throw new Error("R2_ACCESS_KEY_ID is not set");
  if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error("R2_SECRET_ACCESS_KEY is not set");

  return new S3Client({
    region:   "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    // Use native fetch instead of Node's http agent.
    // Prevents SSL handshake failures (EPROTO) when running behind
    // Shopify CLI's dev proxy tunnel.
    requestHandler: {
      fetch: globalThis.fetch,
    },
  });
}

/**
 * Upload a buffer to R2 and return a signed download URL.
 *
 * Files are namespaced by shop:
 *   exports/{shopId}/{filename}
 *
 * @param {object} options
 * @param {Buffer}  options.buffer    - file contents
 * @param {string}  options.filename  - e.g. "products-2026-05-20.csv"
 * @param {string}  options.mimeType  - e.g. "text/csv"
 * @param {string}  options.shopId    - e.g. "my-store.myshopify.com"
 * @returns {Promise<{ signedUrl: string, r2Key: string, expiresAt: Date }>}
 */
export async function uploadToR2({ buffer, filename, mimeType, shopId }) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set");

  const client = getR2Client();
  const r2Key  = `exports/${shopId}/${filename}`;

  // 1. Upload
  try {
    await client.send(
      new PutObjectCommand({
        Bucket:      bucket,
        Key:         r2Key,
        Body:        buffer,
        ContentType: mimeType,
      })
    );
  } catch (err) {
    throw new Error(describeR2Error(err, bucket) ?? `R2 upload failed: ${err.message}`);
  }

  // 2. Generate pre-signed GET URL. PDFs are served inline so the browser
  //    opens them in a viewer tab; every other format forces a download.
  //    ResponseContentDisposition MUST live on the GetObjectCommand input —
  //    in getSignedUrl's options it is silently ignored, and browsers then
  //    render viewable types (XML!) instead of downloading them.
  const disposition = /\.pdf$/i.test(filename) ? "inline" : "attachment";
  const signedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key:    r2Key,
      ResponseContentDisposition: `${disposition}; filename="${filename}"`,
    }),
    { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
  );

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000);

  return { signedUrl, r2Key, expiresAt };
}

/**
 * Upload a buffer at an explicit key (no signed URL). Used for staging an
 * import upload the background worker later downloads server-side.
 *
 * @param {object} options
 * @param {Buffer} options.buffer
 * @param {string} options.key       - full R2 object key
 * @param {string} options.mimeType
 * @returns {Promise<{ r2Key: string }>}
 */
export async function putToR2({ buffer, key, mimeType }) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set");
  const client = getR2Client();
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType,
    }));
  } catch (err) {
    throw new Error(describeR2Error(err, bucket) ?? `R2 upload failed: ${err.message}`);
  }
  return { r2Key: key };
}

/**
 * Download an object from R2 into a Buffer. Used by the import worker to read
 * the staged upload it will process.
 *
 * @param {string} r2Key
 * @returns {Promise<Buffer>}
 */
export async function downloadFromR2(r2Key) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set");
  const client = getR2Client();
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    throw new Error(describeR2Error(err, bucket) ?? `R2 download failed: ${err.message}`);
  }
}

/**
 * Pre-signed GET URL for an existing key with the given filename. Used for
 * the import results workbook and for re-signing files from the dashboard.
 * PDFs are served inline (browser viewer); everything else downloads.
 *
 * @param {string} r2Key
 * @param {string} filename
 * @returns {Promise<{ signedUrl: string, expiresAt: Date }>}
 */
export async function signDownloadUrl(r2Key, filename) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set");
  const client = getR2Client();
  const disposition = /\.pdf$/i.test(filename) ? "inline" : "attachment";
  // Disposition on the command input, not the options — see uploadToR2.
  const signedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key:    r2Key,
      ResponseContentDisposition: `${disposition}; filename="${filename}"`,
    }),
    { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
  );
  return { signedUrl, expiresAt: new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000) };
}

/**
 * Delete a file from R2 by its key.
 * Call this from a cleanup cron job to remove old exports.
 *
 * @param {string} r2Key
 */
export async function deleteFromR2(r2Key) {
  const bucket = process.env.R2_BUCKET_NAME;
  const client = getR2Client();

  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: r2Key })
  );
}