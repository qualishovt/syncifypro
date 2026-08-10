/**
 * import/urlSource.js
 *
 * Pure helpers for "Import from URL" — URL validation, Google Drive link
 * normalization, and file-format sniffing. No Node/server dependencies, so
 * the route component can share the same validation the server enforces
 * (the Import button enables only when the typed URL passes parseImportUrl).
 */

export const IMPORT_URL_PROTOCOLS = ["https", "ftp", "ftps", "sftp", "s3"];

/**
 * Validate a typed import URL.
 *
 * @param {string} raw
 * @returns {{ ok: true, protocol: string, url: URL } | { ok: false, error: string }}
 */
export function parseImportUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "Enter a URL." };

  let url;
  try {
    url = new URL(s);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  if (!IMPORT_URL_PROTOCOLS.includes(protocol)) {
    return { ok: false, error: `Unsupported protocol "${protocol}" — use https, ftp, ftps, sftp or s3.` };
  }
  if (!url.hostname) return { ok: false, error: "The URL is missing a host." };
  // A real web host has a dot (s3:// hosts are bucket names, dots optional).
  if (protocol === "https" && !url.hostname.includes(".")) {
    return { ok: false, error: "The URL is missing a valid host." };
  }
  // https has no folder listing, so it must point at an actual file. The
  // remote-file protocols may omit the path entirely — that's the root folder.
  if (protocol === "https" && !(url.pathname && url.pathname !== "/") && !url.search) {
    return { ok: false, error: "Add the path of the file on the server." };
  }
  return { ok: true, protocol, url };
}

/**
 * Rewrite a Google Drive share link into a direct-download URL.
 * Returns null when the URL isn't a Drive/Sheets link.
 *
 *   drive.google.com/file/d/<id>/view      → drive.google.com/uc?export=download&id=<id>
 *   drive.google.com/open?id=<id>          → drive.google.com/uc?export=download&id=<id>
 *   docs.google.com/spreadsheets/d/<id>/…  → docs.google.com/spreadsheets/d/<id>/export?format=xlsx
 *
 * @param {URL} url
 * @returns {string|null}
 */
export function normalizeGoogleDriveUrl(url) {
  const host = url.hostname.toLowerCase();

  if (host === "docs.google.com") {
    const m = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
    if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
    return null;
  }

  if (host !== "drive.google.com") return null;
  if (url.pathname.startsWith("/uc")) return url.toString(); // already direct
  const file = url.pathname.match(/^\/file\/d\/([\w-]+)/);
  const id = file?.[1] ?? (url.pathname === "/open" ? url.searchParams.get("id") : null);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
}

/**
 * Compose the effective import URL from a saved server + a typed path.
 * Without a server the path IS the URL (the "Direct URL" mode). An https
 * server's host holds its full base URL; other protocols store a bare host
 * and include the username (ftp://user@host/…). The password is NEVER put
 * in the URL — it stays encrypted server-side, and the fetcher completes
 * it from the saved server when the URL carries a username without one.
 *
 * @param {{ protocol: string, host: string, username?: string|null }|null|undefined} server
 * @param {string} path
 * @returns {string}
 */
export function buildRemoteUrl(server, path) {
  const p = String(path ?? "").trim().replace(/^\/+/, "");
  if (!server) return String(path ?? "").trim();
  if (server.protocol === "https") {
    const base = String(server.host || "").replace(/\/+$/, "");
    return p ? `${base}/${p}` : base;
  }
  const user = server.protocol !== "s3" && server.username
    ? `${encodeURIComponent(server.username)}@`
    : "";
  return `${server.protocol}://${user}${server.host}/${p}`;
}

/** Last path segment of a URL, decoded — null when there is none. */
export function filenameFromUrl(url) {
  const seg = url.pathname.split("/").filter(Boolean).pop();
  if (!seg) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Decide the import format ("csv" | "xlsx" | "zip") from whatever signals
 * exist: filename extension, Content-Type, then the file bytes. Both .xlsx
 * and .zip start with "PK" — an OOXML workbook is told apart by its
 * mandatory "[Content_Types].xml" entry. Returns null when clearly none.
 *
 * @param {{ filename?: string|null, contentType?: string|null, buffer?: Buffer|Uint8Array|null }} src
 * @returns {"csv"|"xlsx"|"zip"|null}
 */
export function sniffFormat({ filename, contentType, buffer }) {
  if (filename) {
    if (/\.csv$/i.test(filename)) return "csv";
    if (/\.xlsx?$/i.test(filename)) return "xlsx";
    if (/\.zip$/i.test(filename)) return "zip";
  }
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/csv")) return "csv";
  if (ct.includes("spreadsheetml") || ct.includes("ms-excel")) return "xlsx";
  if (ct.includes("application/zip") || ct.includes("x-zip")) return "zip";

  if (buffer && buffer.length >= 4) {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      // "PK" zip magic: xlsx if it carries the OOXML content-types entry.
      return hasBytes(buffer, "[Content_Types].xml") ? "xlsx" : "zip";
    }
    // Plausible CSV: decodable as text with no NUL bytes in the first 1KB.
    const head = buffer.subarray(0, 1024);
    let binary = false;
    for (const b of head) if (b === 0) { binary = true; break; }
    if (!binary) return "csv";
  }
  return null;
}

/** Byte-search a Buffer/Uint8Array for an ASCII string. */
function hasBytes(buffer, text) {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i <= buffer.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buffer[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
