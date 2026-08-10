/**
 * import/urlSource.server.js
 *
 * Downloads an import file from a remote URL — the server half of
 * "Import from URL". Protocol support:
 *
 *   https://          native fetch (Google Drive/Sheets links are rewritten
 *                     to their direct-download form first)
 *   ftp:// ftps://    basic-ftp
 *   sftp://           ssh2-sftp-client
 *   s3://bucket/key   @aws-sdk/client-s3
 *
 * Credentials come from the URL's user:pass@ part when present, otherwise
 * from the shop's saved servers (matched by protocol + host — the "+ Add a
 * new server" button on the home Import card). s3:// always needs a saved
 * server, since keys don't belong in URLs.
 *
 * Returns { buffer, filename, format } ready for the R2 staging step the
 * file-upload path already uses.
 */

/* global globalThis */
import { parseImportUrl, normalizeGoogleDriveUrl, filenameFromUrl, sniffFormat } from "./urlSource.js";
import { findServerForUrl } from "../db/importServer.server.js";

/** Refuse remote files larger than this (same ballpark as an upload). */
const MAX_BYTES = 100 * 1024 * 1024;

export async function fetchImportSource({ shop, url: raw }) {
  const parsed = parseImportUrl(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const { protocol, url } = parsed;

  let result;
  if (protocol === "https")                       result = await fetchHttps(url);
  else if (protocol === "ftp" || protocol === "ftps") result = await fetchFtp({ shop, url, secure: protocol === "ftps" });
  else if (protocol === "sftp")                   result = await fetchSftp({ shop, url });
  else                                            result = await fetchS3({ shop, url });

  if (result.buffer.length === 0) throw new Error("The URL returned an empty file.");
  if (result.buffer.length > MAX_BYTES) throw new Error("The file is too large to import (100 MB max).");

  const format = sniffFormat({ filename: result.filename, contentType: result.contentType, buffer: result.buffer });
  if (!format) throw new Error("The URL didn't return a CSV or Excel file.");

  // Guarantee the filename carries the right extension for downstream steps.
  let filename = result.filename || "import";
  const extRe = format === "xlsx" ? /\.xlsx?$/i : format === "zip" ? /\.zip$/i : /\.csv$/i;
  if (!extRe.test(filename)) filename += `.${format}`;

  return { buffer: result.buffer, filename, format };
}

// ─── folder support ──────────────────────────────────────────────────────────

/** Files a folder listing considers importable. */
const IMPORTABLE_RE = /\.(csv|xlsx?|zip)$/i;

/**
 * Fetch one OR MANY import files from a URL. When the URL points at a
 * DIRECTORY — an ftp/ftps/sftp folder, or an s3:// prefix ending in "/" —
 * every importable file directly inside it is returned (non-recursive).
 * A file URL (and any https URL) yields a single-element array.
 *
 * @returns {Promise<Array<{ buffer: Buffer, filename: string, format: string }>>}
 */
export async function fetchImportSources({ shop, url: raw }) {
  const parsed = parseImportUrl(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const { protocol, url } = parsed;

  // https can't list a directory — always a single file.
  if (protocol === "https") return [await fetchImportSource({ shop, url: raw })];

  let files;
  if (protocol === "ftp" || protocol === "ftps") files = await listOrFetchFtp({ shop, url, secure: protocol === "ftps" });
  else if (protocol === "sftp")                  files = await listOrFetchSftp({ shop, url });
  else                                           files = await listOrFetchS3({ shop, url });

  const out = [];
  for (const f of files) {
    if (!f.buffer?.length) continue;
    if (f.buffer.length > MAX_BYTES) throw new Error(`"${f.filename}" is too large to import (100 MB max).`);
    const format = sniffFormat({ filename: f.filename, contentType: f.contentType, buffer: f.buffer });
    if (!format) continue; // folders can hold non-importable files — skip them
    let filename = f.filename || "import";
    const extRe = format === "xlsx" ? /\.xlsx?$/i : format === "zip" ? /\.zip$/i : /\.csv$/i;
    if (!extRe.test(filename)) filename += `.${format}`;
    out.push({ buffer: f.buffer, filename, format });
  }
  if (!out.length) throw new Error("No importable files (CSV, Excel or ZIP) found at that URL.");
  return out;
}

// ─── https (+ Google Drive) ──────────────────────────────────────────────────

async function fetchHttps(url) {
  const isDrive = /(^|\.)google\.com$/i.test(url.hostname);
  const target = normalizeGoogleDriveUrl(url) ?? url.toString();

  let res;
  try {
    res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new Error(`Couldn't reach the URL: ${err.cause?.message ?? err.message}`);
  }
  if (!res.ok) throw new Error(`The URL responded with HTTP ${res.status}.`);

  const contentType = res.headers.get("content-type") ?? "";
  // A Drive link that answers with an HTML page is a permissions wall or the
  // big-file confirmation page — either way, not the file.
  if (isDrive && contentType.includes("text/html")) {
    throw new Error('Google Drive returned a web page instead of the file — set the link to "Anyone with the link can view" and try again.');
  }

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("The file is too large to import (100 MB max).");

  const buffer = Buffer.from(await res.arrayBuffer());
  const cd = res.headers.get("content-disposition") ?? "";
  const cdName = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  return { buffer, contentType, filename: cdName ?? filenameFromUrl(new URL(res.url ?? target)) };
}

// ─── credentials shared by ftp/sftp ──────────────────────────────────────────

/** user:pass from the URL when present, else the shop's saved server. */
async function resolveCredentials({ shop, url, protocol, defaults }) {
  if (url.username) {
    const username = decodeURIComponent(url.username);
    let password = url.password ? decodeURIComponent(url.password) : "";
    // A username without a password (what the saved-server picker builds,
    // e.g. ftp://user@host/) completes from the saved server's encrypted
    // password — provided the usernames agree.
    if (!password) {
      const server = await findServerForUrl(shop, protocol, url.hostname);
      if (server && (!server.username || server.username === username)) {
        password = server.password ?? "";
      }
    }
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : defaults.port,
      username,
      password,
    };
  }
  const server = await findServerForUrl(shop, protocol, url.hostname);
  if (server) {
    return {
      host: url.hostname,
      port: server.port ?? defaults.port,
      username: server.username ?? "",
      password: server.password ?? "",
    };
  }
  // Anonymous FTP is a real thing; SFTP without credentials is not.
  if (defaults.anonymous) {
    return { host: url.hostname, port: url.port ? Number(url.port) : defaults.port, username: "anonymous", password: "anonymous@" };
  }
  throw new Error(`No credentials for ${url.hostname} — put user:pass@ in the URL or save the server with the "+" button.`);
}

// ─── ftp / ftps ───────────────────────────────────────────────────────────────

async function fetchFtp({ shop, url, secure }) {
  const { Client } = await import("basic-ftp");
  const { Writable } = await import("node:stream");
  const creds = await resolveCredentials({ shop, url, protocol: secure ? "ftps" : "ftp", defaults: { port: 21, anonymous: true } });

  const chunks = [];
  let size = 0;
  const sink = new Writable({
    write(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) return cb(new Error("The file is too large to import (100 MB max)."));
      chunks.push(chunk);
      cb();
    },
  });

  const client = new Client(60_000);
  try {
    await client.access({
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      secure: secure ? true : false,
    });
    await client.downloadTo(sink, decodeURIComponent(url.pathname));
  } catch (err) {
    throw new Error(`FTP download failed: ${err.message}`);
  } finally {
    client.close();
  }
  return { buffer: Buffer.concat(chunks), contentType: null, filename: filenameFromUrl(url) };
}

/** Folder → every importable file in it; file → single download. */
async function listOrFetchFtp({ shop, url, secure }) {
  const { Client } = await import("basic-ftp");
  const { Writable } = await import("node:stream");
  const creds = await resolveCredentials({ shop, url, protocol: secure ? "ftps" : "ftp", defaults: { port: 21, anonymous: true } });
  const path = decodeURIComponent(url.pathname);

  const client = new Client(60_000);
  try {
    await client.access({
      host: creds.host, port: creds.port,
      user: creds.username, password: creds.password,
      secure: secure ? true : false,
    });

    // A cd() that succeeds means the path is a directory.
    let isDir = true;
    try { await client.cd(path); } catch { isDir = false; }

    if (!isDir) {
      client.close();
      return [await fetchFtp({ shop, url, secure })];
    }

    const names = (await client.list())
      .filter((e) => e.isFile && IMPORTABLE_RE.test(e.name))
      .map((e) => e.name);

    const files = [];
    for (const name of names) {
      const chunks = [];
      let size = 0;
      const sink = new Writable({
        write(chunk, _enc, cb) {
          size += chunk.length;
          if (size > MAX_BYTES) return cb(new Error(`"${name}" is too large to import (100 MB max).`));
          chunks.push(chunk);
          cb();
        },
      });
      await client.downloadTo(sink, name); // cwd is the folder
      files.push({ buffer: Buffer.concat(chunks), contentType: null, filename: name });
    }
    return files;
  } catch (err) {
    throw new Error(`FTP folder import failed: ${err.message}`);
  } finally {
    client.close();
  }
}

// ─── sftp ─────────────────────────────────────────────────────────────────────

async function fetchSftp({ shop, url }) {
  const SftpClient = (await import("ssh2-sftp-client")).default;
  const creds = await resolveCredentials({ shop, url, protocol: "sftp", defaults: { port: 22, anonymous: false } });

  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: creds.host,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      readyTimeout: 30_000,
    });
    const buffer = await sftp.get(decodeURIComponent(url.pathname)); // Buffer when no destination given
    return { buffer, contentType: null, filename: filenameFromUrl(url) };
  } catch (err) {
    throw new Error(`SFTP download failed: ${err.message}`);
  } finally {
    sftp.end().catch(() => {});
  }
}

/** Folder → every importable file in it; file → single download. */
async function listOrFetchSftp({ shop, url }) {
  const SftpClient = (await import("ssh2-sftp-client")).default;
  const creds = await resolveCredentials({ shop, url, protocol: "sftp", defaults: { port: 22, anonymous: false } });
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";

  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: creds.host, port: creds.port,
      username: creds.username, password: creds.password,
      readyTimeout: 30_000,
    });

    const stat = await sftp.stat(path);
    if (!stat.isDirectory) {
      const buffer = await sftp.get(path);
      return [{ buffer, contentType: null, filename: filenameFromUrl(url) }];
    }

    const entries = (await sftp.list(path))
      .filter((e) => e.type === "-" && IMPORTABLE_RE.test(e.name));

    const files = [];
    for (const e of entries) {
      const buffer = await sftp.get(`${path}/${e.name}`);
      files.push({ buffer, contentType: null, filename: e.name });
    }
    return files;
  } catch (err) {
    throw new Error(`SFTP folder import failed: ${err.message}`);
  } finally {
    sftp.end().catch(() => {});
  }
}

// ─── s3 ───────────────────────────────────────────────────────────────────────

async function fetchS3({ shop, url }) {
  const bucket = url.hostname;
  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!key) throw new Error("The s3:// URL is missing the object key (s3://bucket/path/file.csv).");

  const server = await findServerForUrl(shop, "s3", bucket);
  if (!server?.username || !server?.password) {
    throw new Error(`No saved credentials for bucket "${bucket}" — add it with the "+" button (access key + secret).`);
  }

  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: server.region || "us-east-1",
    credentials: { accessKeyId: server.username, secretAccessKey: server.password },
    // Same native-fetch handler the R2 delivery uses — avoids SSL issues
    // behind the Shopify CLI dev proxy.
    requestHandler: { fetch: globalThis.fetch },
  });

  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buffer = Buffer.from(await res.Body.transformToByteArray());
    return { buffer, contentType: res.ContentType ?? null, filename: filenameFromUrl(url) };
  } catch (err) {
    throw new Error(`S3 download failed: ${err.message}`);
  }
}

/** Prefix ending in "/" (or bucket root) → every importable object under it;
 *  else single object. */
async function listOrFetchS3({ shop, url }) {
  const bucket = url.hostname;
  const rawKey = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (rawKey && !rawKey.endsWith("/")) return [await fetchS3({ shop, url })];

  const server = await findServerForUrl(shop, "s3", bucket);
  if (!server?.username || !server?.password) {
    throw new Error(`No saved credentials for bucket "${bucket}" — add it with the "+" button (access key + secret).`);
  }

  const { S3Client, GetObjectCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: server.region || "us-east-1",
    credentials: { accessKeyId: server.username, secretAccessKey: server.password },
    requestHandler: { fetch: globalThis.fetch },
  });

  try {
    const listing = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: rawKey, Delimiter: "/",
    }));
    const keys = (listing.Contents ?? [])
      .map((o) => o.Key)
      .filter((k) => k && k !== rawKey && IMPORTABLE_RE.test(k));

    const files = [];
    for (const k of keys) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
      files.push({
        buffer: Buffer.from(await res.Body.transformToByteArray()),
        contentType: res.ContentType ?? null,
        filename: k.split("/").pop(),
      });
    }
    return files;
  } catch (err) {
    throw new Error(`S3 folder import failed: ${err.message}`);
  }
}
