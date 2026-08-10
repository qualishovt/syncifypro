/**
 * import/urlSource.test.js
 *
 * The pure half of Import-from-URL: validation (drives the Import button's
 * enabled state), Google Drive link rewriting, and format sniffing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { parseImportUrl, normalizeGoogleDriveUrl, filenameFromUrl, sniffFormat, buildRemoteUrl } from "./urlSource.js";

test("parseImportUrl accepts every supported protocol", () => {
  const good = [
    "https://example.com/products.csv",
    "https://drive.google.com/file/d/abc123/view",
    "ftp://files.example.com/exports/products.csv",
    "ftps://files.example.com/exports/products.csv",
    "sftp://user:pass@files.example.com/in/products.xlsx",
    "s3://my-bucket/imports/products.csv",
  ];
  for (const u of good) assert.equal(parseImportUrl(u).ok, true, u);
});

test("parseImportUrl rejects what the Import button must stay disabled for", () => {
  const bad = [
    "",                                  // empty
    "products.csv",                      // no protocol
    "http://example.com/products.csv",   // plain http not offered
    "file:///C:/products.csv",           // local file
    "https://",                          // no host
    "https://localhost/products.csv",    // hostname without a dot
    "https://example.com",               // https can't list a folder — needs a file
  ];
  // (bare ftp/sftp/s3 hosts are VALID now — they mean the root folder)
  for (const u of bad) assert.equal(parseImportUrl(u).ok, false, u);
});

test("Google Drive share links rewrite to direct downloads", () => {
  const cases = [
    ["https://drive.google.com/file/d/FILE_ID_123/view?usp=sharing", "https://drive.google.com/uc?export=download&id=FILE_ID_123"],
    ["https://drive.google.com/open?id=FILE_ID_123", "https://drive.google.com/uc?export=download&id=FILE_ID_123"],
    ["https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=0", "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=xlsx"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeGoogleDriveUrl(new URL(input)), expected, input);
  }
  // Non-Drive URLs pass through as null (caller uses the URL unchanged).
  assert.equal(normalizeGoogleDriveUrl(new URL("https://example.com/f.csv")), null);
});

test("filenameFromUrl takes the decoded last path segment", () => {
  assert.equal(filenameFromUrl(new URL("ftp://h.com/in/My%20Products.csv")), "My Products.csv");
});

test("buildRemoteUrl composes server + path (username in URL, never the password)", () => {
  const ftp = { protocol: "ftp", host: "ftp.example.com", username: "user" };
  assert.equal(buildRemoteUrl(ftp, ""), "ftp://user@ftp.example.com/");
  assert.equal(buildRemoteUrl(ftp, "/feeds/products.csv"), "ftp://user@ftp.example.com/feeds/products.csv");
  assert.equal(buildRemoteUrl({ protocol: "sftp", host: "h.com" }, "in"), "sftp://h.com/in");
  // s3 usernames are access keys — they don't belong in the URL.
  assert.equal(buildRemoteUrl({ protocol: "s3", host: "bucket", username: "AKIA..." }, "k.csv"), "s3://bucket/k.csv");
  assert.equal(buildRemoteUrl({ protocol: "https", host: "https://x.com/exports/", username: "u" }, "p.csv"), "https://x.com/exports/p.csv");
  // usernames with special characters are URL-encoded
  assert.equal(buildRemoteUrl({ protocol: "ftp", host: "h.com", username: "a b" }, ""), "ftp://a%20b@h.com/");
  assert.ok(parseImportUrl(buildRemoteUrl(ftp, "")).ok, "built URL passes validation");
});

test("folder URLs (and bare hosts) validate for listable protocols", () => {
  assert.ok(parseImportUrl("ftp://user:pw@ftp.example.com").ok, "bare ftp host = root folder");
  assert.ok(parseImportUrl("sftp://h.com/feeds/").ok);
  assert.ok(parseImportUrl("s3://bucket").ok, "bare bucket = root prefix");
  assert.ok(!parseImportUrl("https://example.com").ok, "https still needs a file path");
  assert.equal(filenameFromUrl(new URL("https://h.com/")), null);
});

test("sniffFormat: extension, content-type, then magic bytes", () => {
  assert.equal(sniffFormat({ filename: "a.csv" }), "csv");
  assert.equal(sniffFormat({ filename: "a.XLSX" }), "xlsx");
  assert.equal(sniffFormat({ filename: "download", contentType: "text/csv; charset=utf-8" }), "csv");
  assert.equal(sniffFormat({ filename: null, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "xlsx");
  // Both xlsx and zip start with "PK" — the OOXML content-types entry tells them apart.
  assert.equal(sniffFormat({ buffer: Buffer.from("PK\x03\x04junk[Content_Types].xmljunk") }), "xlsx");
  assert.equal(sniffFormat({ buffer: Buffer.from("PK\x03\x04rest-of-zip") }), "zip");
  assert.equal(sniffFormat({ filename: "bundle.zip" }), "zip");
  assert.equal(sniffFormat({ buffer: Buffer.from("sku,title\nA-1,Widget") }), "csv");
  assert.equal(sniffFormat({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) }), null); // PNG
});
