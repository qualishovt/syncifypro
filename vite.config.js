import http from "node:http";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

/**
 * Dev-only: a fixed localhost port (3457) that 302-forwards to the Vite dev
 * server, whose own port `shopify app dev` randomizes per run. Lets external
 * OAuth callbacks (Google) use ONE stable registered redirect URI in dev:
 *   http://localhost:3457/google/callback
 * The callback route is stateless (code + state in the query), so the origin
 * hop is harmless. EADDRINUSE (a second dev instance) is ignored.
 */
function fixedPortForwarder() {
  return {
    name: "fixed-port-oauth-forwarder",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const port = server.httpServer.address().port;
        const fwd = http.createServer((req, res) => {
          res.writeHead(302, { Location: `http://localhost:${port}${req.url}` });
          res.end();
        });
        fwd.on("error", () => {});
        fwd.listen(3457, "127.0.0.1");
        server.httpServer.once("close", () => fwd.close());
      });
    },
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [fixedPortForwarder(), reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
});
