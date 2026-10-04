/**
 * app/routes/app.servers.jsx
 *
 * Remote servers — saved FTP / FTPS / SFTP hosts, HTTPS base URLs, and Amazon
 * S3 buckets. Import-from-URL surfaces (home page and import schedules) offer
 * these in a server picker; credentials never leave the server side
 * (passwords/secrets are AES-encrypted at rest).
 *
 * The page itself now lives in Settings → Servers (components/ServersCard.jsx),
 * as Matrixify and Altera have it. This route keeps only the write action that
 * card posts to, and sends anyone arriving at the old URL to the new place.
 */

import { data, redirect } from "react-router";
import { authenticate } from "../shopify.server.js";

export async function loader({ request }) {
  await authenticate.admin(request);
  // Keep the embedded-app query (host, shop, …) so App Bridge stays happy.
  const qs = new URL(request.url).searchParams;
  qs.set("section", "servers");
  return redirect(`/app/settings?${qs}`);
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "delete") {
    const { deleteImportServer } = await import("../db/importServer.server.js");
    await deleteImportServer(shop, String(fd.get("id")));
    return { ok: true };
  }

  // intent === "save" — create (no id) or update an existing server.
  const { saveImportServer, updateImportServer } = await import("../db/importServer.server.js");
  const id = String(fd.get("id") || "");
  const protocol = String(fd.get("protocol") || "ftp");
  const host = String(fd.get("host") || "").trim();
  if (!host) {
    const what = protocol === "s3" ? "S3 bucket name" : protocol === "https" ? "base URL" : "server host";
    return data({ error: `Enter the ${what}.` }, { status: 400 });
  }
  if (protocol === "https" && !/^https:\/\/.+\..+/i.test(host)) {
    return data({ error: "The base URL must start with https:// and include a host." }, { status: 400 });
  }
  const portRaw = String(fd.get("port") || "").trim();
  const fields = {
    label:    String(fd.get("label") || "").trim() || host,
    protocol,
    host,
    port:     portRaw ? Number(portRaw) : null,
    username: String(fd.get("username") || "").trim(),
    password: String(fd.get("password") || ""), // blank on edit = keep stored
    region:   String(fd.get("region") || "").trim(),
  };
  try {
    if (id) {
      const updated = await updateImportServer(shop, id, fields);
      if (!updated) return data({ error: "Server not found." }, { status: 404 });
    } else {
      await saveImportServer({ shop, ...fields });
    }
  } catch (err) {
    const dup = String(err.code) === "P2002";
    return data({ error: dup ? "A server with that protocol, host and username is already saved." : err.message }, { status: 400 });
  }
  return { ok: true, saved: true };
}
