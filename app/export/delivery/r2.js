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
 *   R2_BUCKET_NAME       — bucket name (e.g. "exportify-exports")
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
  await client.send(
    new PutObjectCommand({
      Bucket:      bucket,
      Key:         r2Key,
      Body:        buffer,
      ContentType: mimeType,
    })
  );

  // 2. Generate pre-signed GET URL
  const signedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: r2Key }),
    {
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }
  );

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000);

  return { signedUrl, r2Key, expiresAt };
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