/**
 * components/ServersCard.jsx
 *
 * Saved remote servers — FTP / FTPS / SFTP hosts, HTTPS base URLs and Amazon
 * S3 buckets — as a section of Settings, the way Matrixify and Altera place
 * them. Rendered inside the Settings page's own Card, so this is only the
 * contents: the saved list and the add/edit form.
 *
 * Writes go to the /app/servers action, which still owns the save/delete
 * logic; Settings' loader supplies the list and revalidates after each write.
 */

import { useState } from "react";
import { useFetcher } from "react-router";
import PolarisSelect from "./PolarisSelect.jsx";
import PolarisTextField from "./PolarisTextField.jsx";
import PolarisPasswordField from "./PolarisPasswordField.jsx";

export const SERVER_PROTOCOLS = [
  { value: "ftp", label: "FTP" },
  { value: "ftps", label: "FTPS" },
  { value: "sftp", label: "SFTP" },
  { value: "https", label: "HTTP(S) URL" },
  { value: "s3", label: "Amazon S3" },
];
const protocolLabel = (p) => SERVER_PROTOCOLS.find((x) => x.value === p)?.label ?? p;

const BLANK = { id: "", label: "", protocol: "ftp", host: "", port: "", username: "", password: "", region: "" };

/* eslint-disable react/prop-types */
export default function ServersCard({ servers }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const [srv, setSrv] = useState(BLANK);
  const setField = (k) => (v) => setSrv((p) => ({ ...p, [k]: v }));
  const editing = srv.id !== "";
  const isS3 = srv.protocol === "s3";
  const isHttp = srv.protocol === "https";

  const submit = (payload) => fetcher.submit(payload, { method: "post", action: "/app/servers" });
  function save() {
    submit({ intent: "save", ...srv });
    setSrv(BLANK);
  }
  const remove = (id) => submit({ intent: "delete", id });
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
    <s-stack direction="block" gap="large">
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

      <s-divider />

      <s-stack direction="block" gap="base">
        <s-heading>{editing ? `Edit server: ${srv.label || srv.host}` : "Add a new server"}</s-heading>
        {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}
        {fetcher.data?.saved && <s-banner tone="success" dismissible>Server saved.</s-banner>}

        <s-stack direction="inline" gap="base">
          <PolarisSelect label="Type" value={srv.protocol} onChange={setField("protocol")}>
            {SERVER_PROTOCOLS.map((p) => (
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
    </s-stack>
  );
}
