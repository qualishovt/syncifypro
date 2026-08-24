import { Links, Meta, Outlet, redirect, Scripts, ScrollRestoration } from "react-router";

// www is an alias, not a home: 301 every www request to the apex so the site
// has exactly one canonical URL per page.
export const loader = ({ request }) => {
  const url = new URL(request.url);
  const host = (request.headers.get("host") || url.host || "").toLowerCase();
  if (host.startsWith("www.")) {
    url.host = host.slice(4);
    url.protocol = "https:";
    url.port = "";
    throw redirect(url.toString(), 301);
  }
  return null;
};

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* Brand icons. The SVG is used by browsers that support it; favicon.ico
            (16/32/48) covers the rest, and the 180px PNG is for iOS home screens. */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/brand/syncifypro-icon-rounded.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
