/**
 * app/routes/app.servers.jsx
 *
 * Remote servers management — saved FTP / FTPS / SFTP hosts, HTTPS base
 * URLs, and Amazon S3 buckets. Import-from-URL surfaces (home page and
 * import schedules) offer these in a server picker; credentials never
 * leave the server side (passwords/secrets are AES-encrypted at rest).
 */

import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisTextField from "../components/PolarisTextField.jsx";
import PolarisPasswordField from "../components/PolarisPasswordField.jsx";

const PROTOCOLS = [
  { value: "ftp", label: "FTP" },
  { value: "ftps", label: "FTPS" },
  { value: "sftp", label: "SFTP" },
  { value: "https", label: "HTTP(S) URL" },
  { value: "s3", label: "Amazon S3" },
];
const protocolLabel = (p) => PROTOCOLS.find((x) => x.value === p)?.label ?? p;

// ─── Loader / Action ───────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
  const servers = (await listImportServers(session.shop)).map(serializeImportServer);
  return { servers };
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

// ─── UI ─────────────────────────────────────────────────────────────────────────

const BLANK = { id: "", label: "", protocol: "ftp", host: "", port: "", username: "", password: "", region: "" };

export default function ServersPage() {
  const { servers } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const [srv, setSrv] = useState(BLANK);
  const setField = (k) => (v) => setSrv((p) => ({ ...p, [k]: v }));
  const editing = srv.id !== "";
  const isS3 = srv.protocol === "s3";
  const isHttp = srv.protocol === "https";

  function save() {
    fetcher.submit({ intent: "save", ...srv }, { method: "post" });
    setSrv(BLANK);
  }
  const remove = (id) => fetcher.submit({ intent: "delete", id }, { method: "post" });
  const startEdit = (s) => setSrv({
    id: s.id,
    label: s.label,
    protocol: s.protocol,
    host: s.host,
    port: s.port != null ? String(s.port) : "",
    username: s.username || "",
    password: "", // never round-tripped — blank keeps the stored secret
    region: s.region || "",
  });

  return (
    <s-page heading="Servers">
      <s-section>
        <s-text color="subdued">
          Saved remote servers for importing files — FTP/FTPS/SFTP hosts, HTTP(S) base URLs and
          Amazon S3 buckets. Pick them from the server dropdown when importing from a URL or
          scheduling an import; passwords and secrets are stored encrypted and never shown again.
        </s-text>
      </s-section>

      <s-section heading="Saved servers">
        {servers.length === 0 ? (
          <s-paragraph>No servers yet. Add one below.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Label</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Host / URL</s-table-header>
              <s-table-header>Port</s-table-header>
              <s-table-header>Username</s-table-header>
              <s-table-header>Region</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {servers.map((s) => (
                <s-table-row key={s.id}>
                  <s-table-cell>{s.label}</s-table-cell>
                  <s-table-cell>{protocolLabel(s.protocol)}</s-table-cell>
                  <s-table-cell>{s.host}</s-table-cell>
                  <s-table-cell>{s.port ?? "—"}</s-table-cell>
                  <s-table-cell>{s.username || "—"}</s-table-cell>
                  <s-table-cell>{s.region || "—"}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300" alignItems="center">
                      <s-tooltip id={`edit-srv-${s.id}`}>Edit</s-tooltip>
                      <s-button
                        variant={srv.id === s.id ? "primary" : "secondary"}
                        icon="edit"
                        interestFor={`edit-srv-${s.id}`}
                        accessibilityLabel={`Edit ${s.label}`}
                        onClick={() => (srv.id === s.id ? setSrv(BLANK) : startEdit(s))}
                      />
                      <s-tooltip id={`del-srv-${s.id}`}>Delete</s-tooltip>
                      <s-button
                        variant="secondary"
                        tone="critical"
                        icon="delete"
                        interestFor={`del-srv-${s.id}`}
                        accessibilityLabel={`Delete ${s.label}`}
                        disabled={busy ? true : undefined}
                        onClick={() => remove(s.id)}
                      />
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={editing ? `Edit server: ${srv.label || srv.host}` : "Add a new server"}>
        <s-stack direction="block" gap="base">
          {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
          {fetcher.data?.saved && <s-banner tone="success" dismissible>Server saved.</s-banner>}

          <s-stack direction="inline" gap="base">
            <PolarisSelect label="Type" value={srv.protocol} onChange={setField("protocol")}>
              {PROTOCOLS.map((p) => (
                <s-option key={p.value} value={p.value}>{p.label}</s-option>
              ))}
            </PolarisSelect>
            <PolarisTextField label="Label" value={srv.label} onChange={setField("label")} placeholder="e.g. Warehouse FTP" />
          </s-stack>

          <PolarisTextField
            label={isS3 ? "Bucket name" : isHttp ? "Base URL" : "Host"}
            value={srv.host}
            onChange={setField("host")}
            placeholder={isS3 ? "my-bucket" : isHttp ? "https://example.com/exports" : "files.example.com"}
          />

          {!isS3 && !isHttp && (
            <s-stack direction="inline" gap="base">
              <PolarisTextField label="Port (optional)" value={srv.port} onChange={setField("port")} placeholder={srv.protocol === "sftp" ? "22" : "21"} />
              <PolarisTextField label="Username" value={srv.username} onChange={setField("username")} />
              <PolarisPasswordField
                label="Password"
                value={srv.password}
                onChange={setField("password")}
                placeholder={editing ? "leave blank to keep the current password" : undefined}
              />
            </s-stack>
          )}
          {isS3 && (
            <s-stack direction="inline" gap="base">
              <PolarisTextField label="Access key ID" value={srv.username} onChange={setField("username")} />
              <PolarisPasswordField
                label="Secret access key"
                value={srv.password}
                onChange={setField("password")}
                placeholder={editing ? "leave blank to keep the current secret" : undefined}
              />
              <PolarisTextField label="Region" value={srv.region} onChange={setField("region")} placeholder="us-east-1" />
            </s-stack>
          )}
          {isHttp && (
            <s-text color="subdued">
              For public HTTP(S) locations — the base URL is prefixed to the path you type when
              importing (e.g. base https://example.com/exports + path products.csv).
            </s-text>
          )}

          <s-stack direction="inline" gap="base">
            <s-button
              variant="primary"
              disabled={!srv.host.trim() || busy ? true : undefined}
              loading={busy ? true : undefined}
              onClick={save}
            >
              {editing ? "Save changes" : "Save server"}
            </s-button>
            {editing && (
              <s-button variant="tertiary" onClick={() => setSrv(BLANK)}>
                Cancel
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
