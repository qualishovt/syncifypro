// Google OAuth callback: /google/callback?code=...&state=<shop>. Exchanges the
// code for tokens, stores them for the shop, and shows a small success page.

import { exchangeCodeAndStore } from "../schedules/google.server.js";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shop = url.searchParams.get("state");
  if (!code || !shop) return new Response("Missing code/state", { status: 400 });

  try {
    const email = await exchangeCodeAndStore(code, shop);
    const who = email ? ` as ${email}` : "";
    return new Response(
      `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;padding:32px">
        <h2>Google connected${who}</h2>
        <p>You can close this window and return to SyncifyPro’s Scheduler.</p>
        <script>
          try { if (window.opener) window.opener.postMessage({ type: "syncify:google-connected" }, "*"); } catch (e) {}
          setTimeout(function(){ window.close(); }, 1200);
        </script>
      </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (e) {
    return new Response(`Google connection failed: ${e?.message || e}`, { status: 500 });
  }
};
