/**
 * migrations/etsy.server.js
 *
 * Etsy Open API v3 connector. Unlike the key/secret platforms, Etsy uses OAuth2
 * with PKCE, so this module also owns the handshake: build the authorize URL,
 * exchange the code, and refresh the token. Data-wise Etsy exposes listings
 * (→ products), shop sections (→ collections), and receipts (→ orders); it has
 * no customers or discounts endpoints.
 *
 * Every request needs BOTH `x-api-key: <keystring>` and `Authorization: Bearer`.
 */

import { randomBytes, createHash } from "node:crypto";

const AUTH_URL = "https://www.etsy.com/oauth/connect";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const API = "https://openapi.etsy.com/v3/application";
const SCOPES = "shops_r listings_r transactions_r email_r";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A PKCE verifier/challenge pair (S256). */
export function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState() {
  return b64url(randomBytes(16));
}

export function buildAuthorizeUrl({ keystring, redirectUri, state, challenge }) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: keystring,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Etsy token request failed (HTTP ${res.status})`);
  return json; // { access_token, refresh_token, expires_in }
}

export async function exchangeCode({ keystring, redirectUri, code, verifier }) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: keystring,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
  });
}

export async function refreshAccessToken({ keystring, refreshToken }) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: keystring,
    refresh_token: refreshToken,
  });
}

/** Resolve the signed-in user's shop (id + name) — needed for every data call. */
export async function fetchShop(conn) {
  const me = await etsyGet(conn, "/users/me");
  const shopId = me.shop_id;
  if (!shopId) throw new Error("This Etsy account has no shop.");
  let shopName = null;
  try { shopName = (await etsyGet(conn, `/shops/${shopId}`)).shop_name ?? null; } catch { /* optional */ }
  return { shopId: String(shopId), shopName };
}

async function etsyGet(conn, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { "x-api-key": conn.keystring, Authorization: `Bearer ${conn.accessToken}` },
  });
  if (!res.ok) throw new Error(`Etsy ${path} returned HTTP ${res.status}`);
  return res.json();
}

const PER_PAGE = 100;
const MAX_PAGES = 500;

/** Page through an Etsy list endpoint (`{ count, results }`, limit/offset). */
async function fetchAll(conn, path, onProgress) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let offset = 0, i = 0; i < MAX_PAGES; i++, offset += PER_PAGE) {
    const body = await etsyGet(conn, `${path}${sep}limit=${PER_PAGE}&offset=${offset}`);
    const results = body.results || [];
    out.push(...results);
    onProgress?.(results.length);
    if (results.length < PER_PAGE) break;
  }
  return out;
}

// ─── mapping helpers ───────────────────────────────────────────────────────────

function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function isoFromEpoch(sec) { if (!sec) return ""; const d = new Date(Number(sec) * 1000); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); }
function money(m) { return m && m.amount != null && m.divisor ? String(m.amount / m.divisor) : ""; }

async function sectionTitleMap(conn) {
  try {
    const sections = await fetchAll(conn, `/shops/${conn.etsyShopId}/sections`);
    return new Map(sections.map((s) => [s.shop_section_id, s.title]));
  } catch { return new Map(); }
}

// ─── fetchers (take the stored connection as their "creds") ─────────────────────

export async function fetchEtsyProducts(conn, onProgress) {
  const sections = await sectionTitleMap(conn);
  const listings = await fetchAll(conn, `/shops/${conn.etsyShopId}/listings?state=active&includes=Images,Inventory`, onProgress);
  const rows = [];
  let rn = 1;

  for (const l of listings) {
    const section = sections.get(l.shop_section_id);
    const tags = [...new Set([...(l.tags || []), ...(section ? [section] : [])])].join(", ");
    const images = (l.images || []).map((im) => im.url_fullxfull).filter(Boolean);
    const base = {
      command: "MERGE", handle: slug(l.title), title: l.title || "", body_html: l.description || "",
      vendor: "", product_type: section || "", tags,
      status: l.state === "active" ? "ACTIVE" : "DRAFT", published: l.state === "active" ? "TRUE" : "FALSE",
    };
    const products = l.inventory?.products || [];

    if (l.has_variations && products.length > 1) {
      products.forEach((pr, i) => {
        const off = (pr.offerings || [])[0] || {};
        const pv = pr.property_values || [];
        const opt = (k) => ({ name: pv[k]?.property_name || "", value: (pv[k]?.values || [])[0] || "" });
        const o1 = opt(0), o2 = opt(1), o3 = opt(2);
        rows.push({
          ...(i === 0 ? base : {}),
          top_row: i === 0 ? "TRUE" : "", row_number: rn++, image_url: i === 0 ? (images[0] || "") : "",
          option1_name: o1.name, option1_value: o1.value,
          option2_name: o2.name, option2_value: o2.value,
          option3_name: o3.name, option3_value: o3.value,
          sku: pr.sku || "", price: money(off.price), compare_at_price: "",
          inventory_qty: off.quantity != null ? String(off.quantity) : "",
        });
      });
    } else {
      const pr = products[0] || {};
      const off = (pr.offerings || [])[0] || {};
      rows.push({
        ...base, top_row: "TRUE", row_number: rn++, image_url: images[0] || "",
        sku: pr.sku || (l.skus || [])[0] || "",
        price: money(off.price) || money(l.price),
        compare_at_price: "",
        inventory_qty: (off.quantity ?? l.quantity) != null ? String(off.quantity ?? l.quantity) : "",
      });
    }
    images.slice(1).forEach((src) => rows.push({ top_row: "", row_number: rn++, image_url: src }));
  }
  return rows;
}

export async function fetchEtsyCollections(conn, onProgress) {
  const sections = await fetchAll(conn, `/shops/${conn.etsyShopId}/sections`, onProgress);
  return sections.filter((s) => s.title).map((s) => ({
    command: "MERGE", handle: slug(s.title), title: s.title, body_html: "",
    collection_type: "smart", rules_match: "any",
    rules: JSON.stringify([{ column: "TAG", relation: "EQUALS", condition: s.title }]),
    image_url: "",
  }));
}

const ETSY_FINANCIAL = {
  paid: "PAID", completed: "PAID", open: "PENDING", "payment processing": "PENDING", canceled: "VOIDED",
};

export async function fetchEtsyOrders(conn, onProgress) {
  const receipts = await fetchAll(conn, `/shops/${conn.etsyShopId}/receipts`, onProgress);
  const rows = [];
  let rn = 1;

  for (const r of receipts) {
    const txns = (r.transactions || []).filter((t) => t.title);
    if (txns.length === 0) continue;
    const nameParts = String(r.name || "").trim().split(/\s+/);
    const top = {
      command: "NEW",
      order_name: r.receipt_id ? `#${r.receipt_id}` : "",
      email: r.buyer_email || "", phone: "",
      financial_status: ETSY_FINANCIAL[String(r.status).toLowerCase()] || (r.is_paid ? "PAID" : "PENDING"),
      fulfillment_status: r.is_shipped ? "FULFILLED" : "",
      currency: r.grandtotal?.currency_code || "",
      created_at: isoFromEpoch(r.created_timestamp),
      total_price: money(r.grandtotal),
      billing_first_name: nameParts[0] || "", billing_last_name: nameParts.slice(1).join(" ") || "",
      billing_address1: r.first_line || "", billing_address2: r.second_line || "",
      billing_city: r.city || "", billing_province: r.state || "", billing_zip: r.zip || "", billing_country: r.country_iso || "",
    };
    txns.forEach((t, i) => {
      rows.push({
        ...(i === 0 ? top : {}),
        line_type: "Line Item", top_row: i === 0 ? "TRUE" : "", row_number: rn++,
        line_item_title: t.title || "", line_item_name: t.title || "",
        line_item_quantity: t.quantity != null ? String(t.quantity) : "",
        line_item_price: money(t.price), line_item_sku: t.sku || "",
      });
    });
  }
  return rows;
}
