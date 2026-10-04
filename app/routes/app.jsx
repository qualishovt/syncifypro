import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import CrispChat from "../components/CrispChat.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  /* eslint-disable no-undef */
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    // Live-chat widget id (Crisp). Unset locally → no bubble.
    crispWebsiteId: process.env.CRISP_WEBSITE_ID || "",
  };
  /* eslint-enable no-undef */
};

export default function App() {
  const { apiKey, shop, crispWebsiteId } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/*
        The admin frame and Polaris section surface are the same white, so cards
        read as flat outlines. Put the page on the admin's subdued grey and pin
        card surfaces to white, as ReportifyPro does. Polaris tokens first, the
        admin's own greys as fallback if a token is ever renamed.
      */}
      <style>{`
        html, body { background: var(--s-color-bg-subdued, #f1f1f1); }
        s-section, s-box[background="base"] {
          background: var(--s-color-bg-base, #ffffff);
        }
      `}</style>
      <s-app-nav>
        {/* rel="home" marks /app as the home route AND hides this link from the
            rendered menu — the app name "SyncifyPro" in the sidebar already links
            here. The home shows Export + Import entry cards; each tool opens on
            its own page (/app/export, /app/import) with a "SyncifyPro > …"
            breadcrumb, so they aren't separate nav items. */}
        <s-link href="/app" rel="home">Home</s-link>
        <s-link href="/app/jobs">Activity</s-link>
        <s-link href="/app/scheduler">Schedules</s-link>
        <s-link href="/app/migrations">Migrations</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
      <CrispChat websiteId={crispWebsiteId} shop={shop} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
