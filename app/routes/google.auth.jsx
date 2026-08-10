// Starts Google OAuth: /google/auth?shop=<shop> → redirect to Google consent.
// Opened in a new window from the Scheduler "Connect Google" button.

import { redirect } from "react-router";
import { getAuthUrl, googleConfigured } from "../schedules/google.server.js";

export const loader = async ({ request }) => {
  if (!googleConfigured()) {
    return new Response(
      "Google OAuth isn't configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      { status: 503 },
    );
  }
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return new Response("Missing shop", { status: 400 });
  return redirect(await getAuthUrl(shop));
};
