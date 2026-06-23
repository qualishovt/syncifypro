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

import { BULK_RECONCILE } from "../export/entities/bulk.js";
import { FIELDS_BY_ENTITY } from "../export/fieldLists.js";
import { columnHeader } from "../export/formats/columns.js";
import { fetchCatalogData } from "../export/entities/catalogPrices.js";
import { isCatalogColumn } from "../export/catalogColumns.js";
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
 * @param {object} [options.admin]     - admin GraphQL client (for catalog prices)
 */
export async function processBulkOperation({ jobId, jsonlUrl, entity, format, shop, fields, admin }) {
  const mimeType  = MIME_TYPES[format] ?? "application/octet-stream";
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
  const filename  = `${entity}-${timestamp}.${format}`;
  const r2Key     = `exports/${shop}/${filename}`;

  const reconcile = BULK_RECONCILE[entity];
  if (!reconcile) throw new Error(`No bulk reconcile config for entity: ${entity}`);

  // Columns to write — selected fields or the entity's full column list
  const columns = fields?.length ? fields : (FIELDS_BY_ENTITY[entity] ?? []);
  const fmt = makeFormatter(format, columns);

  // Catalog prices live in a separate entity — fetch + index them once (when
  // a catalog column is selected and we have an admin client) so the product
  // rows can be joined to them by variant id, same as the direct path.
  const needsCatalogPrices =
    entity === "products" && Array.isArray(fields) && fields.some(isCatalogColumn);
  const catalogData = needsCatalogPrices && admin ? await fetchCatalogData(admin) : undefined;

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
    let   buffer      = fmt.prefix;  // header / opening bracket / xml root
    let   rowCount    = 0;

    // Append one formatted row, flushing a part once we have enough bytes.
    const emitRow = async (row) => {
      buffer += fmt.separator(rowCount) + fmt.encode(row);
      rowCount++;

      if (Buffer.byteLength(buffer, "utf8") >= CHUNK_SIZE) {
        const part = await uploadPart({ client, bucket, r2Key, uploadId, partNumber, body: buffer });
        parts.push(part);
        partNumber++;
        buffer = "";
      }
    };

    if (reconcile.strategy === "parentChild") {
      // Shopify JSONL: a parent line, then its child lines (each carrying
      // __parentId). Collect children under the current parent, then emit
      // normalize(parent, child) rows when the next parent line appears.
      let currentParent = null;
      const pendingChildren = [];

      const flushParent = async () => {
        if (!currentParent) return;
        if (reconcile.buildRows) {
          // rowCount = rows already emitted, so this parent's first row is rowCount + 1.
          for (const row of reconcile.buildRows(currentParent, pendingChildren, rowCount + 1, {
            catalogPriceMap: catalogData?.priceMap,
            catalogs: catalogData?.catalogs,
          })) {
            await emitRow(row);
          }
        } else {
          const children = pendingChildren.length > 0 ? pendingChildren : [null];
          for (const child of children) {
            await emitRow(reconcile.normalize(currentParent, child));
          }
        }
      };

      for await (const line of rl) {
        if (!line.trim()) continue;
        let node;
        try { node = JSON.parse(line); } catch { continue; }

        if (node.__parentId) {
          pendingChildren.push(node);
        } else {
          await flushParent();
          currentParent = node;
          pendingChildren.length = 0;
        }
      }
      await flushParent();
    } else {
      // "flat": one JSONL node = one row (no child lines).
      for await (const line of rl) {
        if (!line.trim()) continue;
        let node;
        try { node = JSON.parse(line); } catch { continue; }
        await emitRow(reconcile.normalize(node));
      }
    }

    // Close the document (json array bracket / xml root); no-op for csv.
    buffer += fmt.suffix;

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

/**
 * Build a streaming serializer for a format. The worker writes
 * `prefix`, then `separator(index) + encode(row)` per row, then `suffix`.
 * This keeps the streamed output identical in shape to the direct-export
 * adapters: CSV with a header, a single JSON array, or an XML <rows> doc.
 */
function makeFormatter(format, columns) {
  if (format === "json") {
    return {
      prefix: "[",
      separator: (i) => (i === 0 ? "\n" : ",\n"),
      encode: (row) => {
        const obj = {};
        for (const col of columns) obj[columnHeader(col)] = row[col] ?? "";
        return JSON.stringify(obj);
      },
      suffix: "\n]",
    };
  }

  if (format === "xml") {
    return {
      prefix: '<?xml version="1.0" encoding="UTF-8"?>\n<rows>',
      separator: () => "\n",
      encode: (row) => {
        const cells = columns
          .map((col) => {
            const tag = xmlElementName(columnHeader(col));
            return `    <${tag}>${escapeXML(row[col] ?? "")}</${tag}>`;
          })
          .join("\n");
        return `  <row>\n${cells}\n  </row>`;
      },
      suffix: "\n</rows>",
    };
  }

  // csv (default): header is the prefix, each row preceded by a newline
  return {
    prefix: columns.map((c) => escapeCSV(columnHeader(c))).join(","),
    separator: () => "\r\n",
    encode: (row) => columns.map((col) => escapeCSV(row[col] ?? "")).join(","),
    suffix: "",
  };
}

function escapeCSV(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function escapeXML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlElementName(col) {
  let name = String(col).replace(/[^a-zA-Z0-9_.-]/g, "_");
  if (!/^[a-zA-Z_]/.test(name)) name = `_${name}`;
  return name;
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