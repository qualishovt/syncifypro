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
import { PLATFORMS, ENTITY_LABELS, filtersFor, getPlatform } from "../migrations/platforms.js";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisDateField from "../components/PolarisDateField.jsx";
import PlatformLogo from "../components/PlatformLogos.jsx";

// ─── loader / action ─────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { getEtsyConnection } = await import("../db/etsyConnection.server.js");
  const { listMigrationConnections, serializeMigrationConnection } = await import("../db/migrationConnection.server.js");
  const conn = await getEtsyConnection(session.shop);
  const { etsyConfigured } = await import("../migrations/etsy.server.js");
  // Saved key/secret connections — client-safe shape (non-secret fields to
  // prefill + a "set" marker per secret; the secrets themselves stay server-side).
  const saved = (await listMigrationConnections(session.shop)).map(serializeMigrationConnection);
  // Only metadata reaches the client — never any entered credentials/tokens.
  return {
    platforms: PLATFORMS,
    shopDomain: session.shop,
    etsy: { connected: Boolean(conn), shopName: conn?.etsyShopName ?? null, configured: etsyConfigured() },
    saved: Object.fromEntries(saved.map((s) => [s.platform, s])),
  };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const platform = String(fd.get("platform") || "");
  let creds = {};
  try { creds = JSON.parse(fd.get("creds") || "{}"); } catch { creds = {}; }

  const meta = getPlatform(platform);
  if (!meta) return data({ error: "Unknown platform." }, { status: 400 });
  if (!meta.implemented) return data({ error: `${meta.label} isn’t connected yet — coming soon.` }, { status: 400 });

  // Migrations are a Pro feature (disconnects stay available for cleanup).
  if (["etsyConnect", "connect", "migrate", "validate"].includes(intent) || !intent) {
    const { getPlan, upgradeError } = await import("../billing.server.js");
    const plan = await getPlan(admin);
    if (!plan.migrations) return data(upgradeError("Migrations", session.shop), { status: 402 });
  }

  // ── Etsy OAuth: start the handshake / disconnect ────────────────────────────
  if (intent === "etsyConnect") {
    // The app-level Etsy keystring is ours (server secret), never merchant input.
    const { pkcePair, randomState, buildAuthorizeUrl, etsyKeystring, etsyRedirectUri } = await import("../migrations/etsy.server.js");
    const keystring = etsyKeystring();
    if (!keystring) return data({ error: "Etsy connection isn’t available on this installation yet." }, { status: 400 });
    const { saveOAuthState } = await import("../db/etsyConnection.server.js");
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const redirectUri = etsyRedirectUri(new URL(request.url).origin);
    await saveOAuthState({ state, shop, keystring, codeVerifier: verifier, redirectUri });
    return { authorizeUrl: buildAuthorizeUrl({ keystring, redirectUri, state, challenge }) };
  }
  if (intent === "etsyDisconnect") {
    const { deleteEtsyConnection } = await import("../db/etsyConnection.server.js");
    await deleteEtsyConnection(shop);
    return { disconnected: true };
  }

  const { validateConnection, runMigration, prepareEtsyConnection } = await import("../migrations/run.server.js");
  const connDb = await import("../db/migrationConnection.server.js");

  // Merge the form's creds over the SAVED connection: a blank secret field on
  // a saved platform means "keep the stored secret" (it never round-trips to
  // the client), so the merchant can re-run without re-typing keys.
  async function effectiveCreds() {
    if (platform === "etsy") return creds;
    const saved = await connDb.getMigrationConnection(shop, platform);
    if (!saved) return creds;
    const merged = { ...saved.creds };
    for (const [k, v] of Object.entries(creds)) if (v != null && String(v).trim() !== "") merged[k] = v;
    return merged;
  }

  try {
    if (intent === "disconnect") {
      await connDb.deleteMigrationConnection(shop, platform);
      return { disconnected: true, platform };
    }

    if (intent === "connect") {
      const useCreds = await effectiveCreds();
      const res = await validateConnection(platform, useCreds);
      if (!res.ok) return data({ error: res.error }, { status: 400 });
      // Success → persist, so "Connected" survives a reload.
      const label = labelFor(platform, useCreds);
      await connDb.saveMigrationConnection({ shop, platform, creds: useCreds, label });
      return { connected: true, platform, counts: res.counts ?? {}, saved: true };
    }

    if (intent === "migrate") {
      const entities = String(fd.get("entities") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!entities.length) return data({ error: "Pick at least one type of data to migrate." }, { status: 400 });
      // Etsy pulls with the stored OAuth connection; the others use the saved
      // connection (with any freshly typed fields layered on top).
      const useCreds = platform === "etsy" ? await prepareEtsyConnection(shop) : await effectiveCreds();
      // Filters: { key: value } — list filters carry an array, date filters a
      // YYYY-MM-DD string. Only known keys pass through.
      let filters = {};
      try { filters = JSON.parse(fd.get("filters") || "{}"); } catch { filters = {}; }
      const known = new Set(filtersFor(platform).map((f) => f.key));
      filters = Object.fromEntries(Object.entries(filters).filter(([k]) => known.has(k)));
      const { key, name } = await runMigration({ platform, creds: useCreds, entities, shop, filters });
      return redirect(`/app/import?src=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`);
    }

    return data({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── page ────────────────────────────────────────────────────────────────────

/* eslint-disable react/prop-types */
/**
 * Multi-value input for "is any of" filters (Altera's "Search or add"): the
 * chosen values as removable chips, a text box that suggests the known
 * options and accepts typed ones on Enter / comma / blur.
 */
function TagInput({ value, options, onChange, disabled }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const commit = (raw) => {
    const vals = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    if (!vals.length) return;
    onChange([...new Set([...value, ...vals])]);
    setText("");
  };
  const remaining = options.filter((o) => !value.includes(o) && o.toLowerCase().includes(text.toLowerCase()));
  return (
    <div style={{ ...tagBox, ...(disabled ? { opacity: 0.6 } : null) }}>
      {value.map((v) => (
        <span key={v} style={tagChip}>
          {v}
          <button type="button" style={tagX} aria-label={`Remove ${v}`} disabled={disabled} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      <input
        style={tagText}
        value={text}
        placeholder={value.length ? "" : "Search or add"}
        disabled={disabled}
        list={undefined}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(text); }
          if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => { commit(text); setFocused(false); }}
      />
      {/* Suggestions from the known options while typing — click to add. */}
      {!disabled && focused && remaining.length > 0 && (
        <span style={tagSuggest}>
          {remaining.slice(0, 8).map((o) => (
            <button key={o} type="button" style={tagSuggestItem} onMouseDown={(e) => { e.preventDefault(); commit(o); }}>{o}</button>
          ))}
        </span>
      )}
    </div>
  );
}
/* eslint-enable react/prop-types */

/** A display label for a saved connection — the store's host where we have one. */
function labelFor(platform, creds) {
  const url = creds?.siteUrl || creds?.baseUrl || "";
  if (url) { try { return new URL(url).host; } catch { return url; } }
  return creds?.storeHash || null;
}

export default function MigrationsPage() {
  const { platforms, etsy, saved, shopDomain } = useLoaderData();
  const connectFetcher = useFetcher();
  const migrateFetcher = useFetcher();
  const etsyFetcher = useFetcher();   // OAuth connect/disconnect
  const disconnectFetcher = useFetcher();
  const revalidator = useRevalidator();

  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? "woocommerce");
  const [introDismissed, setIntroDismissed] = useState(false);
  // Prefill the non-secret fields of each saved connection; secrets stay
  // blank (they never reach the client) but count as "set" — see savedSecrets.
  const [credsByPlatform, setCredsByPlatform] = useState(() =>
    Object.fromEntries(Object.entries(saved ?? {}).map(([id, s]) => [id, { ...s.fields }])));
  const [entities, setEntities] = useState({}); // platformId → Set of selected entity keys
  // Filter rows per platform: [{ id, key, value }] — value is a string[] for
  // list filters ("is any of") or a YYYY-MM-DD string for date filters.
  const [filterRows, setFilterRows] = useState({});

  const platform = platforms.find((p) => p.id === platformId) ?? platforms[0];
  const creds = credsByPlatform[platformId] ?? {};

  const connecting = connectFetcher.state !== "idle";
  const migrating = migrateFetcher.state !== "idle";
  const etsyBusy = etsyFetcher.state !== "idle";
  const busy = connecting || migrating || etsyBusy || disconnectFetcher.state !== "idle";

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
  // are connected when a saved connection exists (persisted on a successful
  // Connect, so it survives reloads) or right after this session's Connect.
  const savedConn = saved?.[platformId] ?? null;
  const oauthConnected = Boolean(platform.oauth && etsy?.connected);
  const freshlyConnected = connectFetcher.data?.connected && connectFetcher.data?.platform === platformId;
  const connected = platform.oauth ? oauthConnected : Boolean(savedConn || freshlyConnected);
  const counts = (!platform.oauth && freshlyConnected) ? (connectFetcher.data.counts ?? {}) : {};
  const error = connectFetcher.data?.error || migrateFetcher.data?.error || etsyFetcher.data?.error;
  // Secret fields the saved connection already holds (shown as stored, not typed).
  const savedSecrets = savedConn?.secretsSet ?? {};

  const selected = entities[platformId] ?? new Set(platform.entities);

  // Connection card accordion: while a platform is connected the credentials
  // collapse behind the header (title + Connected badge + chevron) so the eye
  // lands on "What to migrate"; disconnected platforms always show the form.
  // Keyed per platform; a fresh successful Connect re-collapses it.
  const [connOpenById, setConnOpenById] = useState({});
  const connOpen = connected ? Boolean(connOpenById[platformId]) : true;
  const toggleConn = () => setConnOpenById((prev) => ({ ...prev, [platformId]: !prev[platformId] }));
  useEffect(() => {
    if (freshlyConnected) setConnOpenById((prev) => ({ ...prev, [platformId]: false }));
  }, [freshlyConnected, platformId]);

  function switchPlatform(id) {
    setPlatformId(id);
    if (connectFetcher.data) connectFetcher.load("/app/migrations");
  }
  // Bridge platforms (OpenCart): mint a token, put it in the form, and save the
  // generated PHP file. Fetched (not window.open) so App Bridge authenticates
  // the request inside the embedded frame.
  const [bridgeBusy, setBridgeBusy] = useState(false);
  async function downloadBridge() {
    let token = (credsByPlatform[platformId]?.bridgeToken || "").trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
      const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
      token = "sp_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      setField("bridgeToken", token);
    }
    setBridgeBusy(true);
    try {
      const res = await fetch(`/app/migrations/opencart-bridge?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "syncifypro-bridge.php"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      window.shopify?.toast?.show?.(`Couldn’t generate the bridge file (${e.message})`, { isError: true });
    } finally { setBridgeBusy(false); }
  }
  const setField = (key, value) =>
    setCredsByPlatform((prev) => ({ ...prev, [platformId]: { ...(prev[platformId] ?? {}), [key]: value } }));
  const toggleEntity = (key, on) =>
    setEntities((prev) => {
      const next = new Set(prev[platformId] ?? platform.entities);
      if (on) next.add(key); else next.delete(key);
      return { ...prev, [platformId]: next };
    });

  // A secret the saved connection already holds counts as filled.
  const allFilled = platform.fields.length > 0 && platform.fields.every((f) =>
    String(creds[f.key] ?? "").trim() !== "" || (f.secret && savedSecrets[f.key]));
  const disconnect = () => {
    disconnectFetcher.submit({ intent: "disconnect", platform: platformId }, { method: "post" });
    setCredsByPlatform((prev) => ({ ...prev, [platformId]: {} }));
  };
  // After a successful Connect (saved server-side) or a Disconnect, reload
  // the saved-connections map so the badge and prefill reflect the store.
  useEffect(() => {
    if (connectFetcher.data?.saved || disconnectFetcher.data?.disconnected) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectFetcher.data, disconnectFetcher.data]);

  // Filters for the active platform, and the { key: value } map the action reads.
  const rows = filterRows[platformId] ?? [];
  const setRows = (next) => setFilterRows((prev) => ({ ...prev, [platformId]: next }));
  // The active platform's filter set — each source has its own status
  // vocabulary, and some filters don't exist on some platforms.
  const platformFilters = filtersFor(platformId);
  const filterDef = (key) => platformFilters.find((f) => f.key === key);
  const addFilterRow = () => {
    // Default to the first filter whose entity is selected — usually products.
    const first = platformFilters.find((f) => selected.has(f.entity)) ?? platformFilters[0];
    setRows([...rows, { id: crypto.randomUUID(), key: first.key, value: first.kind === "list" ? [] : "" }]);
  };
  const changeFilterKey = (id, key) => {
    const def = filterDef(key);
    setRows(rows.map((r) => (r.id === id ? { ...r, key, value: def?.kind === "list" ? [] : "" } : r)));
  };
  const changeFilterValue = (id, value) => setRows(rows.map((r) => (r.id === id ? { ...r, value } : r)));
  const removeFilterRow = (id) => setRows(rows.filter((r) => r.id !== id));
  const filtersPayload = () => {
    const out = {};
    for (const r of rows) {
      const def = filterDef(r.key);
      if (!def) continue;
      if (def.kind === "list" ? (Array.isArray(r.value) && r.value.length) : String(r.value ?? "").trim()) out[r.key] = r.value;
    }
    return out;
  };

  const connect = () =>
    connectFetcher.submit({ intent: "connect", platform: platformId, creds: JSON.stringify(creds) }, { method: "post" });
  const migrate = () =>
    migrateFetcher.submit({
      intent: "migrate", platform: platformId, creds: JSON.stringify(creds),
      entities: [...selected].join(","), filters: JSON.stringify(filtersPayload()),
    }, { method: "post" });
  const connectEtsy = () =>
    etsyFetcher.submit({ intent: "etsyConnect", platform: "etsy", creds: "{}" }, { method: "post" });
  const disconnectEtsy = () =>
    etsyFetcher.submit({ intent: "etsyDisconnect", platform: "etsy" }, { method: "post" });

  return (
    <s-page heading="Migrations">
      <s-link slot="breadcrumb-actions" href="/app">SyncifyPro</s-link>

      <s-stack direction="block" gap="base">
        {/* Intro — a white card (not the tinted s-banner): info glyph in a
            blue circle, heading, body, an action, and a dismiss ✕. */}
        {!introDismissed && (
          <s-section>
            <div style={introRow}>
              <span style={introIcon} aria-hidden="true"><s-icon type="info" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={introHeading}>How migrations work</div>
                <div style={introBody}>
                  We pull your data from another platform into an import file you then
                  bring into Shopify — nothing is written to your store until you run
                  the import.
                </div>
              </div>
              <s-button
                variant="tertiary"
                icon="x"
                accessibilityLabel="Dismiss"
                onClick={() => setIntroDismissed(true)}
              />
            </div>
          </s-section>
        )}

        <div style={layout}>
        {/* Left menu — the platforms, Settings-page style: icon + label +
            status line, accent on the active one. */}
        <nav style={menuCol}>
          <div style={menuGroup}>
            <div style={menuGroupTitle}>Platforms</div>
            {platforms.map((p) => {
              const on = p.id === platformId;
              const sc = saved?.[p.id];
              const status = !p.implemented
                ? "Coming soon"
                : p.contact
                  ? "Contact us"
                : p.oauth
                  ? (etsy?.connected ? `Connected${etsy.shopName ? ` · ${etsy.shopName}` : ""}` : "Not connected")
                  : (sc || (connectFetcher.data?.connected && connectFetcher.data?.platform === p.id)
                      ? `Connected${sc?.label ? ` · ${sc.label}` : ""}`
                      : "Not connected");
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => switchPlatform(p.id)}
                  style={{ ...menuItem, ...(on ? menuItemActive : null) }}
                  disabled={busy}
                >
                  <span style={{ ...menuIcon, ...(on ? menuIconActive : null) }}>
                    <PlatformLogo id={p.id} size={20} />
                  </span>
                  <span style={menuText}>
                    <span style={{ ...menuLabel, ...(on ? menuLabelActive : null) }}>{p.label}</span>
                    {/* Connected platforms get a Polaris success badge so the
                        ready ones stand out at a glance; the rest stay text. */}
                    {status.startsWith("Connected") ? (
                      <span style={menuBadgeWrap}>
                        <s-badge tone="success" icon="check-circle" size="small">Connected</s-badge>
                      </span>
                    ) : (
                      <span style={menuValue}>{status}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* The active platform's card */}
        <div style={cardCol}>
        <s-section>
          <s-stack direction="block" gap="base">
            {/* Header: title (+ Connected badge when collapsed) on the left,
                chevron on the right; the whole band toggles when connected. */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div style={{ ...sheetsHeader, ...(connected ? { cursor: "pointer" } : null) }} onClick={connected ? toggleConn : undefined}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: ".6rem" }}>
                <span style={sheetsTitle}>{platform.label}</span>
                {!platform.implemented && <s-badge>Coming soon</s-badge>}
                {connected && !connOpen && (
                  <s-badge tone="success">
                    Connected{platform.oauth ? (etsy?.shopName ? ` · ${etsy.shopName}` : "") : (savedConn?.label ? ` · ${savedConn.label}` : "")}
                  </s-badge>
                )}
              </span>
              {connected && (
                <s-button
                  variant="tertiary"
                  icon={connOpen ? "chevron-up" : "chevron-down"}
                  accessibilityLabel={connOpen ? "Hide connection details" : "Show connection details"}
                  onClick={(e) => { e.stopPropagation(); toggleConn(); }}
                />
              )}
            </div>

            {!connOpen ? null : !platform.implemented ? (
              <s-banner tone="warning">{platform.label} migrations are coming soon.</s-banner>
            ) : platform.contact ? (
              /* ── Assisted platform (Etsy): no self-serve connection ── */
              <div style={helpRow}>
                <div style={helpText}><s-text color="subdued">{platform.help}</s-text></div>
                <s-button variant="primary" href={contactHref(platform.label, shopDomain)} target="_blank">
                  Contact us for {platform.label} migration
                </s-button>
              </div>
            ) : platform.oauth ? (
              /* ── OAuth platform (Etsy) ── */
              oauthConnected ? (
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone="success">Connected{etsy.shopName ? ` · ${etsy.shopName}` : ""}</s-badge>
                  <s-button onClick={disconnectEtsy} disabled={busy}>Disconnect</s-button>
                </s-stack>
              ) : (
                <>
                  {!etsy.configured && (
                    <s-banner tone="warning">Etsy connection isn’t available on this installation yet.</s-banner>
                  )}
                  <div style={helpRow}>
                    <div style={helpText}><s-text color="subdued">{platform.help}</s-text></div>
                    <s-button variant="secondary" onClick={connectEtsy} disabled={busy || !etsy.configured} loading={etsyBusy ? true : undefined}>
                      Connect with Etsy
                    </s-button>
                  </div>
                </>
              )
            ) : (
              /* ── Key/secret platforms ── */
              <>
                {savedConn && (
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone="success">Connected{savedConn.label ? ` · ${savedConn.label}` : ""}</s-badge>
                    <s-text color="subdued">Saved — the stored keys are used until you change them.</s-text>
                    <s-button variant="tertiary" tone="critical" onClick={disconnect} disabled={busy}>Disconnect</s-button>
                  </s-stack>
                )}
                {platform.bridge && (
                  <>
                    <ol style={guideList}>
                      {platform.guide.map((step, i) => <li key={i} style={guideItem}>{step}</li>)}
                    </ol>
                    <div>
                      <s-button variant="secondary" icon="download" onClick={downloadBridge} disabled={busy || bridgeBusy} loading={bridgeBusy ? true : undefined}>
                        Download bridge file
                      </s-button>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: ".8rem", maxWidth: 620 }}>
                  {platform.fields.map((f) => (
                    <label key={f.key} style={field}>
                      <s-text type="strong">{f.label}</s-text>
                      <input style={input} type={f.secret ? "password" : "text"} value={creds[f.key] ?? ""}
                        // A stored secret shows as a placeholder of dots — leave
                        // it blank to keep it, type to replace it.
                        placeholder={f.secret && savedSecrets[f.key] ? "•••••••• (stored — leave blank to keep)" : f.placeholder}
                        disabled={busy} onChange={(e) => setField(f.key, e.target.value)} />
                    </label>
                  ))}
                </div>
                {/* Where to get these keys — numbered steps when the platform
                    needs more than a one-liner (BigCommerce's three API types). */}
                {!platform.bridge && platform.guide?.length > 0 && (
                  <ol style={guideList}>
                    {platform.guide.map((step, i) => <li key={i} style={guideItem}>{step}</li>)}
                  </ol>
                )}
                <div style={helpRow}>
                  <div style={helpText}>{platform.help && <s-text color="subdued">{platform.help}</s-text>}</div>
                  <s-button variant="secondary" onClick={connect} disabled={busy || !allFilled} loading={connecting ? true : undefined}>
                    {connected ? "Reconnect" : "Connect"}
                  </s-button>
                </div>
              </>
            )}

            {error && !connected && <s-banner tone="critical">{error}</s-banner>}
          </s-stack>
        </s-section>

        {/* ── What to migrate — its own card, once connected: the data
            types, the filters, and the Create button. ────────────────── */}
        {connected && (
          <s-section>
            <s-stack direction="block" gap="base">
              <div style={sheetsHeader}>
                <span style={sheetsTitle}>What to migrate</span>
              </div>
              <>
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
                {/* Filters — limit which records the source sends back. Each
                    row: field select · value (multi-value list or a date) ·
                    remove — the export page's filter-row layout. */}
                <s-divider />
                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">Filters</s-text>
                  <s-text color="subdued">
                    Limit which records {platform.label} sends back. Leave empty to pull everything for the selected data.
                  </s-text>
                  {rows.map((r) => {
                    const def = filterDef(r.key) ?? platformFilters[0];
                    return (
                      <div key={r.id} style={filterRow}>
                        <PolarisSelect
                          label="Filter"
                          labelAccessibilityVisibility="exclusive"
                          value={r.key}
                          onChange={(v) => changeFilterKey(r.id, v)}
                          disabled={migrating}
                        >
                          {platformFilters.map((f) => (
                            <s-option key={f.key} value={f.key}>{f.label}</s-option>
                          ))}
                        </PolarisSelect>
                        {def.kind === "list" ? (
                          <TagInput
                            value={Array.isArray(r.value) ? r.value : []}
                            options={def.options}
                            onChange={(v) => changeFilterValue(r.id, v)}
                            disabled={migrating}
                          />
                        ) : (
                          <PolarisDateField
                            label="Date"
                            labelAccessibilityVisibility="exclusive"
                            value={typeof r.value === "string" ? r.value : ""}
                            onChange={(v) => changeFilterValue(r.id, v)}
                            disabled={migrating}
                          />
                        )}
                        <s-clickable
                          accessibilityLabel="Remove filter"
                          onClick={() => removeFilterRow(r.id)}
                          disabled={migrating ? true : undefined}
                          inlineSize="32px"
                          blockSize="32px"
                          borderWidth="base"
                          borderStyle="solid"
                          borderColor="strong"
                          borderRadius="base"
                          background="base"
                        >
                          <div style={squareIconBox}><s-icon type="delete" /></div>
                        </s-clickable>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex" }}>
                    <s-button icon="plus" variant="secondary" onClick={addFilterRow} disabled={migrating}>
                      Add filter
                    </s-button>
                  </div>
                </s-stack>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                  <s-text color="subdued">We’ll pull your data and open the Import page with the file ready.</s-text>
                  <s-button variant="primary" onClick={migrate} disabled={migrating || selected.size === 0} loading={migrating ? true : undefined}>
                    {migrating ? "Pulling data…" : "Create import file"}
                  </s-button>
                </div>
              </>
              {error && <s-banner tone="critical">{error}</s-banner>}
            </s-stack>
          </s-section>
        )}
        </div>
        </div>
      </s-stack>
    </s-page>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────


// Intro card: icon circle · text · dismiss.
const introRow = { display: "flex", alignItems: "flex-start", gap: ".75rem" };
const introIcon = {
  width: 28, height: 28, borderRadius: "50%", background: "#e0f0ff", color: "#00527c",
  display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
};
const introHeading = { fontSize: ".875rem", fontWeight: 650, marginBottom: ".2rem" };
const introBody = { fontSize: ".8125rem", color: "#303030", lineHeight: 1.45 };
// Left menu + card — the Settings page's layout and menu styles.
const layout = {
  display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: "1rem", alignItems: "start",
};
const ACCENT = "#0d9488";
const ACCENT_BG = "#eefaf8";
const menuCol = {
  display: "flex", flexDirection: "column", gap: ".9rem",
  border: "1px solid #e1e3e5", borderRadius: 12, padding: ".6rem", background: "#fff",
};
const menuGroup = { display: "flex", flexDirection: "column", gap: ".1rem" };
const menuGroupTitle = {
  fontSize: ".68rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
  color: "#8a8f96", padding: ".1rem .7rem .3rem",
};
const menuItem = {
  display: "flex", alignItems: "center", gap: ".55rem",
  textAlign: "left", padding: ".45rem .6rem", border: "none",
  background: "transparent", borderRadius: 8, cursor: "pointer", width: "100%",
};
const menuItemActive = { background: ACCENT_BG };
const menuIcon = { display: "inline-flex", color: "#8a8f96" };
const menuIconActive = { color: ACCENT };
const menuText = { display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 };
const menuLabel = { fontSize: ".9rem", fontWeight: 500, color: "#303030" };
const menuLabelActive = { fontWeight: 700, color: ACCENT };
const menuValue = { fontSize: ".72rem", color: "#8a8f96", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
// Badge line under a connected platform's name — a hair of top spacing so
// the badge doesn't crowd the label; the badge itself keeps its own height.
const menuBadgeWrap = { display: "inline-flex", marginTop: 2, maxWidth: "100%", overflow: "hidden" };
// The right column stacks the connection card and the What-to-migrate card.
const cardCol = { minWidth: 0, display: "flex", flexDirection: "column", gap: "1rem" };
// Card title, matching the other pages' hand-rolled headers.
const sheetsHeader = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" };
const sheetsTitle = { fontSize: "0.875rem", fontWeight: 650 };
// One filter row: field select · value · trash (the export page's layout).
const filterRow = {
  display: "grid", gridTemplateColumns: "minmax(200px, 1.2fr) minmax(220px, 2fr) auto",
  gap: ".5rem", alignItems: "center",
};
const squareIconBox = { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" };
// Multi-value "is any of" input: chips + text, styled like a Polaris field.
// Sized to a Polaris text field (32px tall) so it lines up with the operator
// select beside it; grows only when chips wrap to a second line.
const tagBox = {
  position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".25rem .3rem",
  boxSizing: "border-box", minHeight: 32, padding: "0 .5rem",
  border: "1px solid var(--p-color-border-secondary, #8a8f96)", borderRadius: 8, background: "#fff",
};
const tagChip = {
  display: "inline-flex", alignItems: "center", gap: ".25rem", fontSize: ".8125rem",
  height: 22, padding: "0 .25rem 0 .55rem", borderRadius: 999, background: "#e3e5e7", color: "#303030",
};
const tagX = { border: "none", background: "transparent", cursor: "pointer", fontSize: ".9rem", lineHeight: 1, padding: "0 .3rem", color: "#616a75" };
const tagText = { flex: 1, minWidth: 90, height: 24, border: "none", outline: "none", fontSize: ".8125rem", padding: 0, background: "transparent" };
const tagSuggest = {
  position: "absolute", left: 0, right: 0, top: "100%", zIndex: 5, marginTop: 4,
  display: "flex", flexWrap: "wrap", gap: ".3rem", padding: ".4rem .5rem",
  background: "#fff", border: "1px solid #e1e3e5", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.08)",
};
const tagSuggestItem = {
  border: "1px solid #e1e3e5", background: "#f6f6f7", borderRadius: 999, cursor: "pointer",
  fontSize: ".78rem", padding: ".15rem .55rem", color: "#303030",
};
const field = { display: "flex", flexDirection: "column", gap: ".3rem" };
const input = { padding: ".5rem .65rem", borderRadius: 8, border: "1px solid #c9cccf", fontSize: ".9rem", background: "#fff", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
// Help text left, Connect pinned right — the text wraps inside its own
// flexible box instead of pushing the button down to the next line.
/** mailto link for assisted migrations — pre-filled so the request carries the shop + platform. */
function contactHref(label, shop) {
  const subject = encodeURIComponent(`${label} migration request${shop ? ` — ${shop}` : ""}`);
  const body = encodeURIComponent(`Hi SyncifyPro team,

I’d like to migrate my ${label} store to Shopify.

Shopify store: ${shop || ""}
${label} store URL: 
What to migrate (products / customers / orders…): 

Thanks`);
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
const SUPPORT_EMAIL = "support@syncifypro.app";

const helpRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" };
const helpText = { flex: "1 1 auto", minWidth: 0 };
// Numbered "where to get these keys" steps under the fields.
const guideList = { margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: ".3rem", maxWidth: 720 };
const guideItem = { fontSize: ".8125rem", color: "#616a75", lineHeight: 1.45 };
