/**
 * app/routes/migrations.etsy.callback.jsx  →  /migrations/etsy/callback
 *
 * The Etsy OAuth redirect target (a public, NON-embedded route — Etsy sends the
 * browser here). It exchanges the authorization code for tokens, resolves the
 * shop, stores the connection, then renders a tiny page that notifies the opener
 * window and closes itself (the Migrations page opened this in a popup).
 */

function page(bodyHtml) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Etsy</title>
     <style>body{font:14px system-ui;margin:3rem;text-align:center;color:#303030}</style></head>
     <body>${bodyHtml}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const closer = `<script>
  try { if (window.opener) window.opener.postMessage({ type: "etsy-oauth" }, "*"); } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} }, 400);
</script>`;

export async function loader({ request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) return page(`<p>Etsy sign-in was cancelled.</p>${closer}`);
  if (!code || !state) return page(`<p>Missing authorization details.</p>${closer}`);

  const { takeOAuthState, saveEtsyConnection } = await import("../db/etsyConnection.server.js");
  const { exchangeCode, fetchShop } = await import("../migrations/etsy.server.js");

  const st = await takeOAuthState(state);
  if (!st) {
    console.error("[etsy-callback] no OAuth state found for", state);
    return page(`<p>This sign-in link expired. Please try connecting again.</p>${closer}`);
  }

  try {
    const t = await exchangeCode({ keystring: st.keystring, redirectUri: st.redirectUri, code, verifier: st.codeVerifier });
    const { shopId, shopName } = await fetchShop({ keystring: st.keystring, accessToken: t.access_token });
    await saveEtsyConnection({
      shop: st.shop, keystring: st.keystring,
      accessToken: t.access_token, refreshToken: t.refresh_token,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
      etsyShopId: shopId, etsyShopName: shopName,
    });
    return page(`<p><strong>Connected${shopName ? ` to ${shopName}` : ""}.</strong><br>You can close this window.</p>${closer}`);
  } catch (e) {
    console.error("[etsy-callback] connect failed:", e?.message || e);
    return page(`<p>Couldn’t connect to Etsy: ${String(e.message).replace(/[<>&]/g, "")}</p>${closer}`);
  }
}
