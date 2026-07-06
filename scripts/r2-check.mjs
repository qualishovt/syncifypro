/**
 * scripts/r2-check.mjs
 *
 * Quick R2 connectivity/permission check. Verifies the credentials in .env can
 * WRITE to the configured bucket — the exact operation exports depend on.
 *
 *   npm run r2:check
 *
 * Prints "WRITABLE" on success, or the R2 error (e.g. AccessDenied) with a hint.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;

for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME })) {
  if (!v) { console.error(`❌ ${k} is not set in .env`); process.exit(1); }
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  requestHandler: { fetch: globalThis.fetch },
});

console.log(`Checking write access to bucket "${R2_BUCKET_NAME}"…`);
const key = "healthcheck.txt";
try {
  await client.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: "ok" }));
  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })).catch(() => {});
  console.log("✅ WRITABLE — R2 is configured correctly; exports can upload.");
  process.exit(0);
} catch (err) {
  console.error(`❌ ${err.name}: ${err.message}`);
  if (err.name === "AccessDenied") {
    console.error('   → Token can\'t write here. Check R2_BUCKET_NAME matches a real bucket AND the API token has "Object Read & Write" on it.');
  } else if (err.name === "NoSuchBucket") {
    console.error("   → Bucket not found — check R2_BUCKET_NAME.");
  } else if (err.name === "InvalidAccessKeyId") {
    console.error("   → R2_ACCESS_KEY_ID is invalid.");
  } else if (err.name === "SignatureDoesNotMatch") {
    console.error("   → R2_SECRET_ACCESS_KEY is invalid.");
  }
  process.exit(1);
}
