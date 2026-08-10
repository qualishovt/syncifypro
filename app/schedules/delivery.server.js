/**
 * schedules/delivery.server.js
 *
 * File delivery to FTP / FTPS / SFTP servers and Amazon S3 (or any
 * S3-compatible endpoint) for scheduled runs. Ported from ReportifyPro.
 * Server-only; heavy clients load lazily so they only cost when a
 * schedule actually uses that destination.
 */

import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

const toBuffer = (body) => (Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8"));

/**
 * config: { protocol: "ftp"|"ftps"|"sftp", host, port, user, password, path }
 * (password arrives already decrypted — see readDestinations)
 */
export async function uploadToFtp(config, { filename, body }) {
  const protocol = config.protocol || "ftp";
  const host = (config.host || "").trim();
  if (!host) throw new Error("FTP host is required");
  const user = config.user || "";
  const password = config.password || "";
  const dir = (config.path || "").trim().replace(/\/+$/, "");
  const port = parseInt(config.port, 10) || (protocol === "sftp" ? 22 : 21);
  const buf = toBuffer(body);
  const remotePath = dir ? `${dir}/${filename}` : filename;

  if (protocol === "sftp") {
    const SftpClient = (await import("ssh2-sftp-client")).default;
    const sftp = new SftpClient();
    try {
      await sftp.connect({ host, port, username: user, password });
      if (dir) await sftp.mkdir(dir, true).catch(() => {});
      await sftp.put(buf, remotePath);
    } finally {
      await sftp.end().catch(() => {});
    }
    return `Uploaded to sftp://${host}/${remotePath.replace(/^\//, "")}`;
  }

  // ftp (plain) or ftps (explicit TLS) via basic-ftp
  const { Client } = await import("basic-ftp");
  const client = new Client(30000);
  try {
    await client.access({ host, port, user, password, secure: protocol === "ftps" });
    if (dir) await client.ensureDir(dir);
    await client.uploadFrom(Readable.from(buf), filename);
  } finally {
    client.close();
  }
  return `Uploaded to ${protocol}://${host}/${remotePath.replace(/^\//, "")}`;
}

/**
 * Upload to Amazon S3 (or any S3-compatible endpoint). config:
 * { bucket, region, accessKeyId, secretAccessKey, prefix, endpoint }
 */
export async function uploadToS3(config, { filename, body, contentType }) {
  const bucket = (config.bucket || "").trim();
  if (!bucket) throw new Error("S3 bucket is required");
  const region = (config.region || "us-east-1").trim();
  const prefix = (config.prefix || "").trim().replace(/^\/+|\/+$/g, "");
  const key = prefix ? `${prefix}/${filename}` : filename;

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    ...(config.endpoint ? { endpoint: config.endpoint.trim(), forcePathStyle: true } : {}),
    credentials: { accessKeyId: config.accessKeyId || "", secretAccessKey: config.secretAccessKey || "" },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: toBuffer(body),
      ContentType: contentType || "application/octet-stream",
    }),
  );
  return `Uploaded to s3://${bucket}/${key}`;
}
