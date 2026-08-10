/**
 * schedules/google.server.js
 *
 * Google OAuth + Drive/Sheets delivery for scheduled runs. Ported from
 * ReportifyPro. Gated on env credentials:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
 * The redirect URI must be registered in the Google Cloud OAuth client and
 * match <app URL>/google/callback. Tokens live per shop in GoogleConnection.
 */

import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import db from "../db.server.js";

// Lazily load googleapis so it only costs when Google delivery is used.
async function googleLib() {
  return (await import("googleapis")).google;
}

// drive.file (per-file, non-sensitive) covers both Drive uploads and Sheets
// (the Sheet is created via the Drive API by converting CSV), so the
// sensitive `spreadsheets` scope isn't needed.
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

const toBuffer = (body) => (Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8"));

function creds() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  };
}

export function googleConfigured() {
  const c = creds();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

async function oauthClient() {
  if (!googleConfigured()) throw new Error("Google OAuth env not configured");
  const c = creds();
  const google = await googleLib();
  return new google.auth.OAuth2(c.clientId, c.clientSecret, c.redirectUri);
}

export async function getAuthUrl(shop) {
  const o = await oauthClient();
  return o.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: shop,
  });
}

export async function exchangeCodeAndStore(code, shop) {
  const o = await oauthClient();
  const { tokens } = await o.getToken(code);
  o.setCredentials(tokens);

  let email = "";
  try {
    const google = await googleLib();
    const oauth2 = google.oauth2({ version: "v2", auth: o });
    email = (await oauth2.userinfo.get()).data.email || "";
  } catch {
    // userinfo optional
  }

  const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
  await db.googleConnection.upsert({
    where: { shop },
    update: {
      email,
      accessToken: tokens.access_token || "",
      expiryDate,
      scope: tokens.scope || "",
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    },
    create: {
      shop,
      email,
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "",
      expiryDate,
      scope: tokens.scope || "",
    },
  });
  return email;
}

export async function getConnection(shop) {
  try {
    return await db.googleConnection.findUnique({ where: { shop } });
  } catch {
    return null;
  }
}

/** Revoke at Google (best-effort) and delete the stored connection. */
export async function disconnectGoogle(shop) {
  const conn = await db.googleConnection.findUnique({ where: { shop } });
  const token = conn?.refreshToken || conn?.accessToken;
  if (token) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch {
      // ignore revoke network errors — we still drop the local connection
    }
  }
  await db.googleConnection.deleteMany({ where: { shop } });
}

async function authedClient(shop) {
  const conn = await db.googleConnection.findUnique({ where: { shop } });
  if (!conn || !conn.refreshToken) throw new Error("Google account not connected");
  // The token must carry the Drive scope; otherwise uploads return a cryptic
  // "Insufficient Permission". Catch it early with an actionable message.
  if (conn.scope && !conn.scope.includes("drive.file")) {
    throw new Error(
      "Google connected without Drive access. Add the drive.file scope under Data Access " +
        "in the OAuth consent screen (same Cloud project as your client ID), then Disconnect " +
        "and reconnect, allowing the Drive permission.",
    );
  }
  const o = await oauthClient();
  o.setCredentials({
    access_token: conn.accessToken || undefined,
    refresh_token: conn.refreshToken,
    expiry_date: conn.expiryDate ? conn.expiryDate.getTime() : undefined,
  });
  // Persist refreshed access tokens.
  o.on("tokens", async (t) => {
    try {
      await db.googleConnection.update({
        where: { shop },
        data: {
          accessToken: t.access_token || conn.accessToken,
          expiryDate: t.expiry_date ? new Date(t.expiry_date) : conn.expiryDate,
          ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
        },
      });
    } catch {
      // ignore persistence failure
    }
  });
  return o;
}

export async function uploadToDrive(shop, { filename, body, mimeType, folderId }) {
  const auth = await authedClient(shop);
  const google = await googleLib();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    requestBody: { name: filename, ...(folderId ? { parents: [folderId] } : {}) },
    media: { mimeType: mimeType || "application/octet-stream", body: Readable.from(toBuffer(body)) },
    fields: "id,name,webViewLink",
  });
  return res.data;
}

/** Upload CSV and let Drive convert it into a native Google Sheet. */
export async function uploadAsSheet(shop, { name, csv, folderId }) {
  const auth = await authedClient(shop);
  const google = await googleLib();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: { mimeType: "text/csv", body: Readable.from(toBuffer(csv)) },
    fields: "id,name,webViewLink",
  });
  return res.data;
}
