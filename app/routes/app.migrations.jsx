/**
 * app/routes/app.migrations.jsx
 *
 * Migrations (Altera-style): connect a source platform, pull your data, and get
 * an import file you bring into Shopify. A migration fetches from the source,
 * writes an .xlsx in the app's own layout, stages it to R2, and hands the key to
 * the Import page — so the whole import pipeline (mapping, filters, background
 * job, results) is reused.
 *
 * WooCommerce is wired end-to-end; the other platforms show a "coming soon"
 * state until their connector lands.
 */

import { useState, useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { data, redirect } from "react-router";
import { authenticate } from "../shopify.server.js";
import { PLATFORMS, ENTITY_LABELS, getPlatform } from "../migrations/platforms.js";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";

// ─── loader / action ─────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { getEtsyConnection } = await import("../db/etsyConnection.server.js");
  const conn = await getEtsyConnection(session.shop);
  const callbackUrl = `${new URL(request.url).origin}/migrations/etsy/callback`;
  // Only metadata reaches the client — never any entered credentials/tokens.
  return {
    platforms: PLATFORMS,
    etsy: { connected: Boolean(conn), shopName: conn?.etsyShopName ?? null },
    callbackUrl,
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const platform = String(fd.get("platform") || "");
  let creds = {};
  try { creds = JSON.parse(fd.get("creds") || "{}"); } catch { creds = {}; }

  const meta = getPlatform(platform);
  if (!meta) return data({ error: "Unknown platform." }, { status: 400 });
  if (!meta.implemented) return data({ error: `${meta.label} isn’t connected yet — coming soon.` }, { status: 400 });

  // ── Etsy OAuth: start the handshake / disconnect ────────────────────────────
  if (intent === "etsyConnect") {
    const keystring = String(creds.keystring || "").trim();
    if (!keystring) return data({ error: "Enter your Etsy app keystring first." }, { status: 400 });
    const { pkcePair, randomState, buildAuthorizeUrl } = await import("../migrations/etsy.server.js");
    const { saveOAuthState } = await import("../db/etsyConnection.server.js");
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const redirectUri = `${new URL(request.url).origin}/migrations/etsy/callback`;
    await saveOAuthState({ state, shop, keystring, codeVerifier: verifier, redirectUri });
    return { authorizeUrl: buildAuthorizeUrl({ keystring, redirectUri, state, challenge }) };
  }
  if (intent === "etsyDisconnect") {
    const { deleteEtsyConnection } = await import("../db/etsyConnection.server.js");
    await deleteEtsyConnection(shop);
    return { disconnected: true };
  }

  const { validateConnection, runMigration, prepareEtsyConnection } = await import("../migrations/run.server.js");

  try {
    if (intent === "connect") {
      const res = await validateConnection(platform, creds);
      return res.ok ? { connected: true, platform, counts: res.counts ?? {} } : data({ error: res.error }, { status: 400 });
    }

    if (intent === "migrate") {
      const entities = String(fd.get("entities") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!entities.length) return data({ error: "Pick at least one type of data to migrate." }, { status: 400 });
      // Etsy pulls with the stored OAuth connection; the others use form creds.
      const useCreds = platform === "etsy" ? await prepareEtsyConnection(shop) : creds;
      const { key, name } = await runMigration({ platform, creds: useCreds, entities, shop });
      return redirect(`/app/import?src=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`);
    }

    return data({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function MigrationsPage() {
  const { platforms, etsy, callbackUrl } = useLoaderData();
  const connectFetcher = useFetcher();
  const migrateFetcher = useFetcher();
  const etsyFetcher = useFetcher();   // OAuth connect/disconnect
  const revalidator = useRevalidator();

  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? "woocommerce");
  const [credsByPlatform, setCredsByPlatform] = useState({});
  const [entities, setEntities] = useState({}); // platformId → Set of selected entity keys

  const platform = platforms.find((p) => p.id === platformId) ?? platforms[0];
  const creds = credsByPlatform[platformId] ?? {};

  const connecting = connectFetcher.state !== "idle";
  const migrating = migrateFetcher.state !== "idle";
  const etsyBusy = etsyFetcher.state !== "idle";
  const busy = connecting || migrating || etsyBusy;

  // Open Etsy's authorize page in a popup once the connect action returns a URL.
  useEffect(() => {
    const url = etsyFetcher.data?.authorizeUrl;
    if (url) window.open(url, "etsy-oauth", "width=640,height=820");
  }, [etsyFetcher.data]);

  // The callback popup postMessages when done — revalidate to pick up the token.
  useEffect(() => {
    function onMsg(e) { if (e?.data?.type === "etsy-oauth") revalidator.revalidate(); }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [revalidator]);

  // Connection state: OAuth platforms use the server-loaded status; the others
  // unlock after a successful "Connect".
  const oauthConnected = Boolean(platform.oauth && etsy?.connected);
  const connected = platform.oauth
    ? oauthConnected
    : (connectFetcher.data?.connected && connectFetcher.data?.platform === platformId);
  const counts = (!platform.oauth && connected) ? (connectFetcher.data.counts ?? {}) : {};
  const error = connectFetcher.data?.error || migrateFetcher.data?.error || etsyFetcher.data?.error;

  const selected = entities[platformId] ?? new Set(platform.entities);

  function switchPlatform(id) {
    setPlatformId(id);
    if (connectFetcher.data) connectFetcher.load("/app/migrations");
  }
  const setField = (key, value) =>
    setCredsByPlatform((prev) => ({ ...prev, [platformId]: { ...(prev[platformId] ?? {}), [key]: value } }));
  const toggleEntity = (key, on) =>
    setEntities((prev) => {
      const next = new Set(prev[platformId] ?? platform.entities);
      if (on) next.add(key); else next.delete(key);
      return { ...prev, [platformId]: next };
    });

  const allFilled = platform.fields.length > 0 && platform.fields.every((f) => String(creds[f.key] ?? "").trim() !== "");

  const connect = () =>
    connectFetcher.submit({ intent: "connect", platform: platformId, creds: JSON.stringify(creds) }, { method: "post" });
  const migrate = () =>
    migrateFetcher.submit({ intent: "migrate", platform: platformId, creds: JSON.stringify(creds), entities: [...selected].join(",") }, { method: "post" });
  const connectEtsy = () =>
    etsyFetcher.submit({ intent: "etsyConnect", platform: "etsy", creds: JSON.stringify({ keystring: creds.keystring || "" }) }, { method: "post" });
  const disconnectEtsy = () =>
    etsyFetcher.submit({ intent: "etsyDisconnect", platform: "etsy" }, { method: "post" });

  return (
    <s-page heading="Migrations">
      <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>

      <s-stack direction="block" gap="base">
        <s-banner tone="info">
          Migrations pull your data from another platform and create an import file you can then bring into Shopify.
        </s-banner>

        <s-section>
          <s-stack direction="block" gap="base">

            {/* Platform tabs */}
            <div style={tabRow}>
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => switchPlatform(p.id)}
                  style={{ ...tab, ...(p.id === platformId ? tabActive : null) }}
                  disabled={busy}
                >
                  {p.label}
                  {!p.implemented && <span style={soonDot}>soon</span>}
                </button>
              ))}
            </div>

            {!platform.implemented ? (
              <s-banner tone="warning">{platform.label} migrations are coming soon.</s-banner>
            ) : platform.oauth ? (
              /* ── OAuth platform (Etsy) ── */
              oauthConnected ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone="success">Connected{etsy.shopName ? ` · ${etsy.shopName}` : ""}</s-badge>
                  <s-button onClick={disconnectEtsy} disabled={busy}>Disconnect</s-button>
                </s-stack>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: ".8rem", maxWidth: 620 }}>
                    <label style={field}>
                      <s-text type="strong">Etsy app keystring (API key)</s-text>
                      <input style={input} value={creds.keystring ?? ""} placeholder="abcdefghijklmnopqrstuvwx"
                        disabled={busy} onChange={(e) => setField("keystring", e.target.value)} />
                    </label>
                    <s-text color="subdued">Add this redirect URI to your Etsy app:</s-text>
                    <code style={codeBox}>{callbackUrl}</code>
                  </div>
                  <div style={helpRow}>
                    <s-text color="subdued">{platform.help}</s-text>
                    <s-button variant="primary" onClick={connectEtsy} disabled={busy || !(creds.keystring || "").trim()} loading={etsyBusy ? true : undefined}>
                      Connect with Etsy
                    </s-button>
                  </div>
                </>
              )
            ) : (
              /* ── Key/secret platforms ── */
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: ".8rem", maxWidth: 620 }}>
                  {platform.fields.map((f) => (
                    <label key={f.key} style={field}>
                      <s-text type="strong">{f.label}</s-text>
                      <input style={input} type={f.secret ? "password" : "text"} value={creds[f.key] ?? ""}
                        placeholder={f.placeholder} disabled={busy} onChange={(e) => setField(f.key, e.target.value)} />
                    </label>
                  ))}
                </div>
                <div style={helpRow}>
                  <s-text color="subdued">{platform.help}</s-text>
                  <s-button variant="primary" onClick={connect} disabled={busy || !allFilled} loading={connecting ? true : undefined}>
                    {connected ? "Reconnect" : "Connect"}
                  </s-button>
                </div>
              </>
            )}

            {/* Data selection (once connected, any platform) */}
            {connected && (
              <>
                <s-divider />
                <s-text type="strong">What to migrate</s-text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem 1.2rem" }}>
                  {platform.entities.map((e) => (
                    <PolarisCheckbox
                      key={e}
                      label={`${ENTITY_LABELS[e] ?? e}${counts[e] != null ? ` (${counts[e].toLocaleString()})` : ""}`}
                      checked={selected.has(e)}
                      onChange={(on) => toggleEntity(e, on)}
                      disabled={migrating}
                    />
                  ))}
                </div>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-button variant="primary" onClick={migrate} disabled={migrating || selected.size === 0} loading={migrating ? true : undefined}>
                    {migrating ? "Pulling data…" : "Create import file"}
                  </s-button>
                  <s-text color="subdued">We’ll pull your data and open the Import page with the file ready.</s-text>
                </s-stack>
              </>
            )}

            {error && <s-banner tone="critical">{error}</s-banner>}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const tabRow = { display: "flex", gap: ".3rem", flexWrap: "wrap", borderBottom: "1px solid #e1e3e5", paddingBottom: ".5rem" };
const tab = {
  display: "inline-flex", alignItems: "center", gap: ".35rem",
  padding: ".4rem .8rem", border: "1px solid #e1e3e5", borderRadius: 8,
  background: "#fff", cursor: "pointer", fontSize: ".9rem", fontWeight: 600, color: "#303030",
};
const tabActive = { background: "#eefaf8", borderColor: "#0d9488", color: "#0d9488" };
const soonDot = { fontSize: ".62rem", fontWeight: 700, textTransform: "uppercase", color: "#8a8f96", letterSpacing: ".04em" };
const field = { display: "flex", flexDirection: "column", gap: ".3rem" };
const input = { padding: ".5rem .65rem", borderRadius: 8, border: "1px solid #c9cccf", fontSize: ".9rem", background: "#fff", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
const helpRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" };
const codeBox = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: ".82rem",
  padding: ".4rem .6rem", borderRadius: 8, border: "1px solid #e1e3e5", background: "#f6f6f7",
  color: "#303030", wordBreak: "break-all", maxWidth: 620,
};
