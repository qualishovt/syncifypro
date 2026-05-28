/**
 * export/delivery/shopifyFiles.js
 *
 * Uploads an export file to the merchant's Shopify Files library
 * using the stagedUploadsCreate → file upload → fileCreate flow.
 *
 * The three-step process Shopify requires:
 *   1. stagedUploadsCreate  — get a pre-signed S3 URL from Shopify
 *   2. PUT the file bytes   — upload directly to that S3 URL
 *   3. fileCreate           — tell Shopify to register the file
 *
 * Returns the public CDN URL of the uploaded file.
 * Files appear in the merchant's Shopify Admin → Content → Files.
 *
 * Note: Shopify Files are always PUBLIC. Do not use for sensitive
 * data (customer PII, financials) — use S3/R2 with signed URLs instead.
 */

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ... on GenericFile {
          id
          url
          createdAt
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Upload a file buffer to Shopify Files and return its public URL.
 *
 * @param {object} options
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} options.admin
 * @param {Buffer}  options.buffer    - file contents
 * @param {string}  options.filename  - e.g. "products-2026-05-20.csv"
 * @param {string}  options.mimeType  - e.g. "text/csv"
 * @returns {Promise<{ fileUrl: string, filename: string }>}
 */
export async function uploadToShopifyFiles({ admin, buffer, filename, mimeType }) {
  // ── Step 1: Request a pre-signed staged upload URL from Shopify ──────────
  const stagedRes = await admin.graphql(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [
        {
          filename,
          mimeType,
          resource:   "FILE",
          fileSize:   String(buffer.byteLength),
          httpMethod: "POST",
        },
      ],
    },
  });

  const { data: stagedData } = await stagedRes.json();
  const userErrors = stagedData?.stagedUploadsCreate?.userErrors ?? [];

  if (userErrors.length) {
    throw new Error(`stagedUploadsCreate error: ${userErrors.map((e) => e.message).join(", ")}`);
  }

  const target = stagedData.stagedUploadsCreate.stagedTargets[0];
  const { url, resourceUrl, parameters } = target;

  // ── Step 2: POST the file to Shopify's pre-signed S3 URL ─────────────────
  // Shopify uses multipart/form-data for staged uploads.
  const form = new FormData();

  // All parameters must come BEFORE the file field
  for (const { name, value } of parameters) {
    form.append(name, value);
  }

  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const uploadRes = await fetch(url, { method: "POST", body: form });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Staged upload failed (${uploadRes.status}): ${text}`);
  }

  // ── Step 3: Register the file in Shopify's Files library ─────────────────
  const fileRes = await admin.graphql(FILE_CREATE, {
    variables: {
      files: [
        {
          originalSource: resourceUrl,
          contentType:    "FILE",
          filename,
        },
      ],
    },
  });

  const { data: fileData } = await fileRes.json();
  const fileErrors = fileData?.fileCreate?.userErrors ?? [];

  if (fileErrors.length) {
    throw new Error(`fileCreate error: ${fileErrors.map((e) => e.message).join(", ")}`);
  }

  // Shopify may take a moment to process the file — the URL is available
  // immediately from resourceUrl even before fileCreate fully resolves.
  const createdFile = fileData?.fileCreate?.files?.[0];
  const fileUrl = createdFile?.url ?? resourceUrl;

  return { fileUrl, filename };
}