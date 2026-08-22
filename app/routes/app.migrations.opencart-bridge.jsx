/**
 * app/routes/app.migrations.opencart-bridge.jsx  →  /app/migrations/opencart-bridge?token=…
 *
 * Serves the OpenCart bridge file with the merchant's token baked in. The
 * Migrations page generates the token client-side, puts it in the connection
 * form, then fetches this route (App Bridge adds the session token) and saves
 * the response as syncifypro-bridge.php for the merchant to upload.
 */

import { authenticate } from "../shopify.server";
// Bundled as a string by Vite, so the built server needs no file lookup.
import template from "../migrations/opencart-bridge.php.template?raw";

export async function loader({ request }) {
  await authenticate.admin(request);
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return new Response("Invalid token", { status: 400 });
  const php = template.replace("__SYNCIFYPRO_TOKEN__", token);
  return new Response(php, {
    headers: {
      "Content-Type": "application/x-php; charset=utf-8",
      "Content-Disposition": 'attachment; filename="syncifypro-bridge.php"',
      "Cache-Control": "no-store",
    },
  });
}
