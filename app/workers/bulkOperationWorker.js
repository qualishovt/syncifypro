/**
 * workers/bulkOperationWorker.js
 *
 * Called by the webhook handler when Shopify completes a bulk operation.
 * Streams the JSONL result file, transforms rows, and uploads to R2
 * using multipart upload — never holds the full dataset in memory.
 *
 * Flow:
 *   Shopify webhook → webhooks.bulk-operations.jsx
 *     → bulkOperationWorker({ jobId, jsonlUrl, entity, format, shop })
 *       → streams JSONL line by line
 *       → normalizes each line into a row
 *       → formats rows into CSV/Excel/etc chunks
 *       → streams chunks to R2 via multipart upload
 *       → marks job complete in DB
 */

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl }  from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createInterface } from "readline";
import { Readable }        from "stream";

import { normalizeProduct } from "../export/normalizer.js";
import { PRODUCT_CSV_COLUMNS, toCSV } from "../export/formats/csv.js";
import { markJobComplete, markJobFailed } from "../db/bulkExportJob.server.js";

/** Minimum R2 multipart chunk size — 5MB (R2's minimum) */
const CHUNK_SIZE = 5 * 1024 * 1024;

/** Signed URL expiry — 1 hour */
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60;

const MIME_TYPES = {
  csv:  "text/csv",
  json: "application/json",
  xml:  "application/xml",
};

/**
 * Process a completed bulk operation — stream, transform, upload.
 *
 * @param {object} options
 * @param {string} options.jobId       - BulkExportJob DB id
 * @param {string} options.jsonlUrl    - Shopify's JSONL download URL
 * @param {string} options.entity      - "products" | "orders" | …
 * @param {string} options.format      - "csv" | "json" | …
 * @param {string} options.shop        - "my-store.myshopify.com"
 * @param {string[]} [options.fields]  - column selection (undefined = all)
 */
export async function processBulkOperation({ jobId, jsonlUrl, entity, format, shop, fields }) {
  const mimeType  = MIME_TYPES[format] ?? "application/octet-stream";
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
  const filename  = `${entity}-${timestamp}.${format}`;
  const r2Key     = `exports/${shop}/${filename}`;

  // Columns to write — selected fields or all product columns
  const columns = fields?.length ? fields : PRODUCT_CSV_COLUMNS;

  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;

  let uploadId;

  try {
    // ── 1. Start R2 multipart upload ────────────────────────────────────────
    const createRes = await client.send(
      new CreateMultipartUploadCommand({
        Bucket:      bucket,
        Key:         r2Key,
        ContentType: mimeType,
      })
    );
    uploadId = createRes.UploadId;

    // ── 2. Stream JSONL from Shopify ────────────────────────────────────────
    const jsonlRes = await fetch(jsonlUrl);
    if (!jsonlRes.ok) throw new Error(`Failed to fetch JSONL: ${jsonlRes.status}`);

    // readline processes the stream line by line — never loads the full file
    const rl = createInterface({
      input:     Readable.fromWeb(jsonlRes.body),
      crlfDelay: Infinity,
    });

    const parts       = [];
    let   partNumber  = 1;
    let   buffer      = "";    // accumulates CSV rows until chunk is full
    let   rowCount    = 0;
    let   headerWritten = false;

    // Write CSV header once
    if (format === "csv") {
      buffer += columns.join(",") + "\r\n";
      headerWritten = true;
    }

    // Shopify JSONL: each line is one node (product or variant).
    // Child nodes (variants) have a __parentId field linking to their product.
    // We collect variants under their product then normalize when the next
    // product line appears (i.e. we flush the previous product's rows).
    let currentProduct = null;
    const pendingVariants = [];

    async function flushProduct() {
      if (!currentProduct) return;

      const variants = pendingVariants.length > 0 ? pendingVariants : [null];
      for (const variant of variants) {
        const row = normalizeProduct(currentProduct, variant);
        buffer += formatRow(row, format, columns) + "\r\n";
        rowCount++;
      }

      // Upload a part when we've accumulated enough data
      if (Buffer.byteLength(buffer, "utf8") >= CHUNK_SIZE) {
        const part = await uploadPart({ client, bucket, r2Key, uploadId, partNumber, body: buffer });
        parts.push(part);
        partNumber++;
        buffer = "";
      }
    }

    for await (const line of rl) {
      if (!line.trim()) continue;

      let node;
      try {
        node = JSON.parse(line);
      } catch {
        continue; // skip malformed lines
      }

      if (node.__parentId) {
        // This is a variant — attach to current product
        pendingVariants.push(node);
      } else {
        // New product — flush previous product first
        await flushProduct();
        currentProduct = node;
        pendingVariants.length = 0;
      }
    }

    // Flush the last product
    await flushProduct();

    // ── 3. Upload remaining buffer as final part ─────────────────────────────
    // R2 requires at least one part — even if everything fit in the buffer
    if (buffer.length > 0 || parts.length === 0) {
      const part = await uploadPart({ client, bucket, r2Key, uploadId, partNumber, body: buffer });
      parts.push(part);
    }

    // ── 4. Complete multipart upload ─────────────────────────────────────────
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket:          bucket,
        Key:             r2Key,
        UploadId:        uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      })
    );

    // ── 5. Generate signed URL ────────────────────────────────────────────────
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key:    r2Key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: SIGNED_URL_EXPIRY_SECONDS }
    );

    const signedUrlExpiry = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000);

    // ── 6. Mark job complete ──────────────────────────────────────────────────
    await markJobComplete({ id: jobId, r2Key, signedUrl, signedUrlExpiry, rowCount });

  } catch (err) {
    // Abort the multipart upload to avoid orphaned parts in R2
    if (uploadId) {
      await client.send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: r2Key, UploadId: uploadId })
      ).catch(() => {}); // don't throw if abort also fails
    }

    await markJobFailed({ id: jobId, errorMessage: err.message });
    throw err;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function uploadPart({ client, bucket, r2Key, uploadId, partNumber, body }) {
  const res = await client.send(
    new UploadPartCommand({
      Bucket:     bucket,
      Key:        r2Key,
      UploadId:   uploadId,
      PartNumber: partNumber,
      Body:       Buffer.from(body, "utf8"),
    })
  );
  return { partNumber, etag: res.ETag };
}

function formatRow(row, format, columns) {
  if (format === "csv") {
    return columns.map((col) => escapeCSV(row[col] ?? "")).join(",");
  }
  if (format === "json") {
    // For JSON, only include selected columns
    const filtered = {};
    for (const col of columns) filtered[col] = row[col] ?? "";
    return JSON.stringify(filtered);
  }
  return JSON.stringify(row); // fallback
}

function escapeCSV(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function getR2Client() {
  return new S3Client({
    region:   "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: { fetch: globalThis.fetch },
  });
}