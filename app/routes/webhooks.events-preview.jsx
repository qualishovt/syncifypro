/**
 * app/routes/webhooks.events-preview.jsx  →  /webhooks/events-preview
 *
 * Sink for the placeholder Events (developer preview) subscription that the
 * app contract now requires in shopify.app.toml. We don't act on these
 * deliveries yet — this route just verifies and acknowledges them so Shopify
 * doesn't retry. Replace with a real handler if we ever adopt Events.
 */

import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  await authenticate.webhook(request);
  return new Response();
};
