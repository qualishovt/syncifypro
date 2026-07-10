import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {/* rel="home" marks /app as the home route AND hides this link from the
            rendered menu — the app name "SyncifyPro" in the sidebar already links
            here. The home shows Export + Import entry cards; each tool opens on
            its own page (/app/export, /app/import) with a "SyncifyPro > …"
            breadcrumb, so they aren't separate nav items. */}
        <s-link href="/app" rel="home">Home</s-link>
        <s-link href="/app/migrations">Migrations</s-link>
        <s-link href="/app/scheduler">Scheduler</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
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
