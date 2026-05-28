/**
 * app/routes/app.export.jsx
 *
 * Handles both direct exports (small stores, signed URL returned immediately)
 * and bulk exports (large stores, job ID returned, UI polls for completion).
 */

import { useState, useEffect } from "react";
import { useFetcher }           from "react-router";
import { data }                 from "react-router";
import { authenticate }         from "../shopify.server.js";
import { runExportJob }         from "../export/exportJob.js";
import { getJob }               from "../db/bulkExportJob.server.js";

// ─── Action: start export ─────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const entity   = formData.get("entity") ?? "products";
  const format   = formData.get("format") ?? "csv";

  try {
    const result = await runExportJob({ admin, shop: session.shop, entity, format });

    if (result.mode === "direct") {
      return {
        mode:      "direct",
        signedUrl: result.signedUrl,
        filename:  result.filename,
        expiresAt: result.expiresAt.toISOString(),
      };
    }

    // Bulk: return jobId so UI can poll
    return { mode: "bulk", jobId: result.jobId };

  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── Loader: poll job status ──────────────────────────────────────────────────

export async function loader({ request }) {
  await authenticate.admin(request);

  const url   = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return {};

  const job = await getJob(jobId);
  if (!job)  return data({ error: "Job not found" }, { status: 404 });

  return {
    jobId:      job.id,
    status:     job.status,
    signedUrl:  job.signedUrl,
    filename:   `${job.entity}-export.${job.format}`,
    expiresAt:  job.signedUrlExpiry?.toISOString(),
    rowCount:   job.rowCount,
    error:      job.errorMessage,
  };
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const ENTITIES = ["products", "orders", "collections", "discounts", "customers"];
const FORMATS  = ["csv", "excel", "xml", "json"];

export default function ExportPage() {
  const [entity, setEntity] = useState("products");
  const [format, setFormat] = useState("csv");
  const fetcher = useFetcher();

  // For bulk jobs — poll the loader every 3s until complete/failed
  const [pollingJobId, setPollingJobId] = useState(null);
  const pollFetcher = useFetcher();

  const isExporting = fetcher.state !== "idle";
  const result      = fetcher.data;

  // When action returns a bulk job, start polling
  useEffect(() => {
    if (result?.mode === "bulk" && result.jobId) {
      setPollingJobId(result.jobId);
    }
  }, [result]);

  // Poll every 3 seconds while job is pending/running
  useEffect(() => {
    if (!pollingJobId) return;

    const pollStatus = pollFetcher.data?.status;
    if (pollStatus === "complete" || pollStatus === "failed") return;

    const interval = setInterval(() => {
      pollFetcher.load(`/app/export?jobId=${pollingJobId}`);
    }, 3000);

    return () => clearInterval(interval);
  }, [pollingJobId, pollFetcher.data?.status]);

  function handleExport() {
    setPollingJobId(null);
    const formData = new FormData();
    formData.set("entity", entity);
    formData.set("format", format);
    fetcher.submit(formData, { method: "post" });
  }

  // Resolve the download result from either direct or polled bulk job
  const downloadResult = (() => {
    if (result?.mode === "direct") return result;
    if (pollFetcher.data?.status === "complete") return pollFetcher.data;
    return null;
  })();

  const bulkError = pollFetcher.data?.status === "failed"
    ? pollFetcher.data.error ?? "Export failed"
    : null;

  const isPolling = pollingJobId &&
    pollFetcher.data?.status !== "complete" &&
    pollFetcher.data?.status !== "failed";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 500, marginBottom: "2rem" }}>Export</h1>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

        <label style={labelStyle}>
          Entity
          <select value={entity} onChange={(e) => setEntity(e.target.value)} style={selectStyle}>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)} style={selectStyle}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>{f.toUpperCase()}</option>
            ))}
          </select>
        </label>

        <button onClick={handleExport} disabled={isExporting || isPolling} style={buttonStyle}>
          {isExporting ? "Starting export…" : "Export"}
        </button>

        {/* Errors */}
        {(result?.error || bulkError) && (
          <p style={{ color: "red", fontSize: ".9rem" }}>{result?.error ?? bulkError}</p>
        )}

        {/* Bulk job progress */}
        {isPolling && (
          <div style={infoBox}>
            <p style={{ margin: 0, fontSize: ".9rem" }}>
              ⏳ Large store detected — Shopify is processing your export in the background.
              This page will update automatically when it&apos;s ready.
            </p>
            <p style={{ margin: 0, fontSize: ".8rem", color: "#666" }}>
              Status: {pollFetcher.data?.status ?? "pending"}
              {pollFetcher.data?.rowCount ? ` · ${pollFetcher.data.rowCount.toLocaleString()} rows` : ""}
            </p>
          </div>
        )}

        {/* Download link — shown for both direct and bulk */}
        {downloadResult?.signedUrl && (
          <div style={resultBox}>
            <p style={{ margin: 0, fontSize: ".9rem" }}>Your file is ready:</p>
            <a
              href={downloadResult.signedUrl}
              download={downloadResult.filename}
              rel="noreferrer"
              style={downloadLink}
            >
              ↓ {downloadResult.filename}
              {downloadResult.rowCount
                ? ` (${downloadResult.rowCount.toLocaleString()} rows)`
                : ""}
            </a>
            <p style={{ margin: 0, fontSize: ".8rem", color: "#666" }}>
              Link expires at {new Date(downloadResult.expiresAt).toLocaleTimeString()}.
              Re-export to get a new link.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle = {
  display: "flex", flexDirection: "column", gap: ".4rem",
  fontSize: ".9rem", fontWeight: 500,
};

const selectStyle = {
  padding: ".5rem .75rem", borderRadius: 6,
  border: "1px solid #ccc", fontSize: ".9rem", fontWeight: 400,
};

const buttonStyle = {
  alignSelf: "flex-start", padding: ".5rem 1.25rem",
  background: "#000", color: "#fff", borderRadius: 6,
  border: "none", fontSize: ".875rem", cursor: "pointer",
};

const resultBox = {
  display: "flex", flexDirection: "column", gap: ".5rem",
  padding: "1rem", background: "#f0fdf4", borderRadius: 8,
  marginTop: ".5rem",
};

const infoBox = {
  display: "flex", flexDirection: "column", gap: ".4rem",
  padding: "1rem", background: "#fefce8", borderRadius: 8,
};

const downloadLink = {
  fontSize: "1rem", fontWeight: 500, color: "#000",
};