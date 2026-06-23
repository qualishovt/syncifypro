/**
 * app/routes/app.import.jsx
 *
 * Matrixify-style two-step import:
 *
 *   1. Upload a file → server parses + validates (analyzeImport) →
 *      preview counts, detected columns, sample rows, validation errors.
 *   2. Merchant confirms → same file is re-submitted with mode=apply →
 *      server parses, validates, and writes → results report.
 *
 * Re-submitting the file (instead of round-tripping the parsed rows)
 * keeps state on the client and avoids serialising potentially-large
 * validRows arrays back through the action.
 */

import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import { data }       from "react-router";
import { authenticate } from "../shopify.server.js";
import { analyzeImport, applyImport } from "../import/importJob.js";

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const mode   = formData.get("mode")   ?? "analyze";   // "analyze" | "apply"
  const entity = formData.get("entity") ?? "products";
  const format = formData.get("format") ?? "csv";
  const file   = formData.get("file");

  if (!file || typeof file === "string") {
    return data({ error: "No file uploaded." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  try {
    const analysis = analyzeImport({ fileBuffer, format, entity });

    if (mode === "analyze") {
      // Strip validRows from the response — preview UI doesn't need them.
      const preview = { ...analysis };
      delete preview.validRows;
      return { mode: "analyze", preview };
    }

    // mode === "apply"
    const { created, updated, errors: writeErrors } =
      await applyImport({ validRows: analysis.validRows, entity, admin });

    return {
      mode: "apply",
      report: {
        parsed:  analysis.parsed,
        valid:   analysis.valid,
        invalid: analysis.invalid,
        created,
        updated,
        validationErrors: analysis.validationErrors,
        writeErrors,
      },
    };
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const ENTITIES = ["products", "orders", "redirects"];
const FORMATS  = ["csv"]; // parsers/{excel,xml,json} are stubbed; expose csv only for now

export default function ImportPage() {
  const fetcher = useFetcher();

  const [entity, setEntity] = useState("products");
  const [format, setFormat] = useState("csv");
  const [file, setFile]     = useState(null);
  const fileInputRef = useRef(null);

  const busy   = fetcher.state !== "idle";
  const data_  = fetcher.data;
  const preview = data_?.mode === "analyze" ? data_.preview : null;
  const report  = data_?.mode === "apply"   ? data_.report  : null;
  const error   = data_?.error;

  function buildFormData(mode) {
    const fd = new FormData();
    fd.set("mode",   mode);
    fd.set("entity", entity);
    fd.set("format", format);
    if (file) fd.set("file", file);
    return fd;
  }

  function handleAnalyze() {
    if (!file) return;
    fetcher.submit(buildFormData("analyze"), { method: "post", encType: "multipart/form-data" });
  }

  function handleApply() {
    if (!file) return;
    fetcher.submit(buildFormData("apply"), { method: "post", encType: "multipart/form-data" });
  }

  function handleReset() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Clear fetcher data so the preview / report panes go away.
    fetcher.submit(null, { method: "get" }); // no-op load; clears action data
  }

  return (
    <s-page heading="Import">
      <s-stack direction="block" gap="base">

        {/* ── Step 1: pick file + entity + format ──────────────────── */}
        <s-section heading="1. Choose file">
          <s-stack direction="block" gap="base">

            <div style={twoColGrid}>
              <label style={labelStyle}>
                <s-text type="strong">Entity</s-text>
                <select
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                  style={selectStyle}
                  disabled={busy || Boolean(preview) || Boolean(report)}
                >
                  {ENTITIES.map((e) => (
                    <option key={e} value={e}>{capitalize(e)}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                <s-text type="strong">Format</s-text>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  style={selectStyle}
                  disabled={busy || Boolean(preview) || Boolean(report)}
                >
                  {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                </select>
              </label>
            </div>

            <label style={labelStyle}>
              <s-text type="strong">File</s-text>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xml,.json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={inputStyle}
                disabled={busy}
              />
              {file && (
                <s-text color="subdued">
                  {file.name} · {formatBytes(file.size)}
                </s-text>
              )}
            </label>

            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={handleAnalyze}
                disabled={!file || busy || Boolean(preview) || Boolean(report)}
              >
                {busy && !preview && !report ? "Analyzing…" : "Analyze file"}
              </s-button>
              {(preview || report || file) && (
                <s-button onClick={handleReset} disabled={busy}>
                  Start over
                </s-button>
              )}
            </s-stack>

            {error && <s-banner tone="critical">{error}</s-banner>}

          </s-stack>
        </s-section>

        {/* ── Step 2: preview (after analyze, before apply) ────────── */}
        {preview && !report && (
          <s-section heading="2. Preview">
            <s-stack direction="block" gap="base">

              <div style={statsGrid}>
                <Stat label="Rows parsed" value={preview.parsed} />
                <Stat label="Valid" value={preview.valid} tone={preview.valid > 0 ? "success" : undefined} />
                <Stat label="Invalid" value={preview.invalid} tone={preview.invalid > 0 ? "critical" : undefined} />
              </div>

              {preview.detectedColumns.length > 0 && (
                <details style={detailsStyle} open>
                  <summary style={summaryStyle}>
                    Detected columns ({preview.detectedColumns.length})
                  </summary>
                  <s-paragraph>
                    <s-text color="subdued">
                      {preview.detectedColumns.join(", ")}
                    </s-text>
                  </s-paragraph>
                </details>
              )}

              {preview.sampleRows.length > 0 && (
                <details style={detailsStyle}>
                  <summary style={summaryStyle}>
                    Sample rows ({preview.sampleRows.length})
                  </summary>
                  <div style={{ overflowX: "auto", marginTop: ".75rem" }}>
                    <table style={sampleTable}>
                      <thead>
                        <tr>
                          {preview.detectedColumns.map((c) => (
                            <th key={c} style={sampleTh}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.map((row, i) => (
                          <tr key={i}>
                            {preview.detectedColumns.map((c) => (
                              <td key={c} style={sampleTd}>{truncate(String(row[c] ?? ""), 60)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {preview.validationErrors.length > 0 && (
                <details style={detailsStyle}>
                  <summary style={summaryStyle}>
                    Validation errors ({preview.validationErrors.length})
                  </summary>
                  <s-stack direction="block" gap="small-200">
                    {preview.validationErrors.slice(0, 50).map((e, i) => (
                      <s-text key={i} color="subdued">
                        Row {e.row} — <s-text type="strong">{e.field}</s-text>: {e.message}
                      </s-text>
                    ))}
                    {preview.validationErrors.length > 50 && (
                      <s-text color="subdued">
                        … and {preview.validationErrors.length - 50} more.
                      </s-text>
                    )}
                  </s-stack>
                </details>
              )}

              {preview.valid === 0 ? (
                <s-banner tone="critical">
                  No rows are importable — fix the validation errors above and re-analyze.
                </s-banner>
              ) : (
                <s-banner tone="info">
                  Ready to import <s-text type="strong">{preview.valid}</s-text> row
                  {preview.valid === 1 ? "" : "s"} to Shopify
                  {preview.invalid > 0 && ` (${preview.invalid} invalid will be skipped)`}.
                </s-banner>
              )}

              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  onClick={handleApply}
                  disabled={busy || preview.valid === 0}
                >
                  {busy ? "Importing…" : `Apply import (${preview.valid})`}
                </s-button>
              </s-stack>

            </s-stack>
          </s-section>
        )}

        {/* ── Results report (after apply) ─────────────────────────── */}
        {report && (
          <s-section heading="Import results">
            <s-stack direction="block" gap="base">

              <div style={statsGrid}>
                <Stat label="Created" value={report.created} tone="success" />
                <Stat label="Updated" value={report.updated} tone="success" />
                <Stat label="Skipped (invalid)" value={report.invalid} tone={report.invalid > 0 ? "critical" : undefined} />
                <Stat label="Write errors" value={report.writeErrors.length} tone={report.writeErrors.length > 0 ? "critical" : undefined} />
              </div>

              {report.writeErrors.length > 0 && (
                <details style={detailsStyle} open>
                  <summary style={summaryStyle}>
                    Shopify write errors ({report.writeErrors.length})
                  </summary>
                  <s-stack direction="block" gap="small-200">
                    {report.writeErrors.slice(0, 50).map((e, i) => (
                      <s-text key={i} color="subdued">
                        <s-text type="strong">{e.product ?? "(unknown)"}</s-text>:{" "}
                        {e.message ?? JSON.stringify(e.userErrors)}
                      </s-text>
                    ))}
                  </s-stack>
                </details>
              )}

              {report.validationErrors.length > 0 && (
                <details style={detailsStyle}>
                  <summary style={summaryStyle}>
                    Validation errors ({report.validationErrors.length})
                  </summary>
                  <s-stack direction="block" gap="small-200">
                    {report.validationErrors.slice(0, 50).map((e, i) => (
                      <s-text key={i} color="subdued">
                        Row {e.row} — <s-text type="strong">{e.field}</s-text>: {e.message}
                      </s-text>
                    ))}
                  </s-stack>
                </details>
              )}

            </s-stack>
          </s-section>
        )}

      </s-stack>
    </s-page>
  );
}

// ─── small helpers ────────────────────────────────────────────────────────────

// eslint-disable-next-line react/prop-types
function Stat({ label, value, tone }) {
  return (
    <div style={statBox}>
      <s-text color="subdued">{label}</s-text>
      <s-text type="strong">
        {tone ? <s-badge tone={tone}>{value?.toLocaleString() ?? 0}</s-badge> : (value?.toLocaleString() ?? 0)}
      </s-text>
    </div>
  );
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─── styles (form inputs only; layout uses Polaris) ──────────────────────────

const labelStyle = {
  display: "flex", flexDirection: "column", gap: ".35rem",
};
const twoColGrid = {
  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem",
};
const selectStyle = {
  padding: ".45rem .6rem", borderRadius: 6,
  border: "1px solid #c9cccf", fontSize: ".875rem", background: "#fff",
};
const inputStyle = { ...selectStyle, padding: ".4rem" };
const detailsStyle = {
  border: "1px solid #e1e3e5", borderRadius: 8, padding: ".5rem .9rem",
};
const summaryStyle = {
  cursor: "pointer", fontWeight: 600, fontSize: ".9rem", padding: ".25rem 0",
};
const statsGrid = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: ".75rem",
};
const statBox = {
  display: "flex", flexDirection: "column", gap: ".3rem",
  padding: ".75rem 1rem", border: "1px solid #e1e3e5",
  borderRadius: 8, background: "#fafbfb",
};
const sampleTable = {
  width: "100%", borderCollapse: "collapse", fontSize: ".82rem",
};
const sampleTh = {
  textAlign: "left", padding: ".4rem .5rem",
  borderBottom: "1px solid #e1e3e5", fontWeight: 600,
};
const sampleTd = {
  padding: ".4rem .5rem", borderBottom: "1px solid #f1f2f3",
};
