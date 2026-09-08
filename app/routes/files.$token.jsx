/**
 * routes/files.$token.jsx
 *
 * Streams a stored file (export result, import source, results workbook)
 * from R2 through the app's own domain. Links are minted by
 * export/delivery/r2.js (signDownloadUrl / uploadToR2) as signed, expiring
 * tokens — see utils/fileToken.server.js for why downloads no longer point
 * the browser at R2 directly.
 *
 * No Shopify session is needed: the token itself is the credential (HMAC
 * over key + filename + expiry), exactly like the pre-signed URL it replaced,
 * so external services given a link (FTP pulls, "download from URL") still
 * work.
 */

import { verifyFileToken } from "../utils/fileToken.server.js";

const MIME_BY_EXT = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  xml: "application/xml",
  json: "application/json",
  pdf: "application/pdf",
  zip: "application/zip",
  txt: "text/plain; charset=utf-8",
};

function mimeFor(filename, fromStore) {
  if (fromStore && fromStore !== "application/octet-stream") return fromStore;
  const ext = String(filename).split(".").pop()?.toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

// RFC 6266: ASCII-safe filename plus a UTF-8 filename* for non-ASCII names.
function contentDisposition(disposition, filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(String(filename));
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function loader({ params, request }) {
  const claims = verifyFileToken(params.token);
  if (!claims) {
    return new Response("This download link is invalid or has expired. Open the job in SyncifyPro for a fresh one.", {
      status: 410,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const { openR2Object } = await import("../export/delivery/r2.js");
  let obj;
  try {
    obj = await openR2Object(claims.key);
  } catch (err) {
    const notFound = /NoSuchKey|not found|404/i.test(String(err?.message || err));
    return new Response(notFound ? "This file is no longer available (it may have been cleaned up)." : "The file could not be read right now. Please try again.", {
      status: notFound ? 404 : 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const headers = {
    "Content-Type": mimeFor(claims.filename, obj.contentType),
    "Content-Disposition": contentDisposition(claims.disposition, claims.filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (Number.isFinite(obj.contentLength)) headers["Content-Length"] = String(obj.contentLength);

  // HEAD: size/type only (link checkers, "download from URL" probes).
  if (request.method === "HEAD") {
    obj.body?.cancel?.();
    return new Response(null, { status: 200, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}
