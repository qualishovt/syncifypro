/**
 * app/routes/app.export.jsx
 *
 * Export UI with:
 *   - entity + format pickers
 *   - row filters (status, vendor, tag, date range)
 *   - column/field selection (checkboxes)
 *   - direct download (small stores) or bulk polling (large stores)
 */

import { useState, useEffect } from "react";
import { useFetcher }           from "react-router";
import { data }                 from "react-router";
import { authenticate }         from "../shopify.server.js";
import { runExportJob }         from "../export/exportJob.js";
import { getJob }               from "../db/bulkExportJob.server.js";

// All available columns per entity (used for field-selection checkboxes)
const PRODUCT_FIELDS = [
  "product_id", "title", "handle", "status", "vendor", "product_type",
  "tags", "description", "image_url", "variant_id", "variant_title",
  "sku", "price", "compare_at_price", "inventory_qty", "barcode",
  "weight", "weight_unit", "taxable", "created_at", "updated_at",
];

const ORDER_FIELDS = [
  "order_id", "order_name", "email", "phone", "financial_status",
  "fulfillment_status", "currency", "total_price", "subtotal_price",
  "total_tax", "total_shipping", "total_discounts", "note", "tags",
  "cancel_reason", "cancelled_at", "processed_at", "created_at", "updated_at",
  "customer_id", "customer_email", "customer_first_name", "customer_last_name",
  "billing_first_name", "billing_last_name", "billing_company",
  "billing_address1", "billing_address2", "billing_city", "billing_province",
  "billing_zip", "billing_country", "billing_phone",
  "shipping_first_name", "shipping_last_name", "shipping_company",
  "shipping_address1", "shipping_address2", "shipping_city", "shipping_province",
  "shipping_zip", "shipping_country", "shipping_phone",
  "line_item_id", "line_item_title", "line_item_variant_title",
  "line_item_sku", "line_item_vendor", "line_item_quantity",
  "line_item_price", "line_item_discounted_price", "line_item_total_discount",
  "line_item_taxable", "line_item_requires_shipping",
  "line_item_fulfillment_status", "line_item_product_id", "line_item_variant_id",
];

/** Field list per entity — entities without a list fall back to products */
const FIELDS_BY_ENTITY = {
  products: PRODUCT_FIELDS,
  orders:   ORDER_FIELDS,
};

// ─── Action ────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const entity   = formData.get("entity") ?? "products";
  const format   = formData.get("format") ?? "csv";

  // Filters arrive as a JSON string
  let filters = {};
  try {
    filters = JSON.parse(formData.get("filters") ?? "{}");
  } catch { /* ignore malformed */ }

  // Fields arrive as a comma-separated string; empty = all fields
  const fieldsRaw = formData.get("fields") ?? "";
  const fields = fieldsRaw ? fieldsRaw.split(",") : undefined;

  try {
    const result = await runExportJob({
      admin, shop: session.shop, entity, format, filters, fields,
    });

    if (result.mode === "direct") {
      return {
        mode: "direct",
        signedUrl: result.signedUrl,
        filename:  result.filename,
        expiresAt: result.expiresAt.toISOString(),
      };
    }
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
    jobId:     job.id,
    status:    job.status,
    signedUrl: job.signedUrl,
    filename:  `${job.entity}-export.${job.format}`,
    expiresAt: job.signedUrlExpiry?.toISOString(),
    rowCount:  job.rowCount,
    error:     job.errorMessage,
  };
}

// ─── UI ───────────────────────────────────────────────────────────────────────

const ENTITIES = ["products", "orders", "collections", "discounts", "customers"];
const FORMATS  = ["csv", "excel", "xml", "json"];
const STATUSES = ["", "active", "draft", "archived"];

export default function ExportPage() {
  const [entity, setEntity] = useState("products");
  const [format, setFormat] = useState("csv");

  // The available fields for the currently selected entity
  const availableFields = FIELDS_BY_ENTITY[entity] ?? PRODUCT_FIELDS;

  // Row filters
  const [status, setStatus]           = useState("");
  const [vendor, setVendor]           = useState("");
  const [tag, setTag]                 = useState("");
  const [createdAtMin, setCreatedMin] = useState("");
  const [createdAtMax, setCreatedMax] = useState("");

  // Column selection — all fields checked by default
  const [selectedFields, setSelectedFields] = useState(availableFields);

  // When the entity changes, reset the field selection to that entity's fields
  function handleEntityChange(newEntity) {
    setEntity(newEntity);
    setSelectedFields(FIELDS_BY_ENTITY[newEntity] ?? PRODUCT_FIELDS);
  }

  const fetcher     = useFetcher();
  const pollFetcher = useFetcher();
  const [pollingJobId, setPollingJobId] = useState(null);

  const isExporting = fetcher.state !== "idle";
  const result      = fetcher.data;

  useEffect(() => {
    if (result?.mode === "bulk" && result.jobId) setPollingJobId(result.jobId);
  }, [result]);

  useEffect(() => {
    if (!pollingJobId) return;
    const s = pollFetcher.data?.status;
    if (s === "complete" || s === "failed") return;
    const interval = setInterval(() => {
      pollFetcher.load(`/app/export?jobId=${pollingJobId}`);
    }, 3000);
    return () => clearInterval(interval);
  }, [pollingJobId, pollFetcher.data?.status]);

  function toggleField(field) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  function handleExport() {
    setPollingJobId(null);

    // Build filters object — only include non-empty values
    const filters = {};
    if (status)       filters.status = status;
    if (vendor)       filters.vendor = vendor;
    if (tag)          filters.tag = tag;
    if (createdAtMin) filters.createdAtMin = createdAtMin;
    if (createdAtMax) filters.createdAtMax = createdAtMax;

    const formData = new FormData();
    formData.set("entity", entity);
    formData.set("format", format);
    formData.set("filters", JSON.stringify(filters));
    // Only send fields if user deselected some (otherwise export all)
    if (selectedFields.length !== availableFields.length) {
      formData.set("fields", selectedFields.join(","));
    }

    fetcher.submit(formData, { method: "post" });
  }

  const downloadResult = (() => {
    if (result?.mode === "direct") return result;
    if (pollFetcher.data?.status === "complete") return pollFetcher.data;
    return null;
  })();

  const bulkError = pollFetcher.data?.status === "failed"
    ? pollFetcher.data.error ?? "Export failed" : null;

  const isPolling = pollingJobId &&
    pollFetcher.data?.status !== "complete" &&
    pollFetcher.data?.status !== "failed";

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "2rem 1rem", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 500, marginBottom: "2rem" }}>Export</h1>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Entity + format */}
        <div style={{ display: "flex", gap: "1rem" }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Entity
            <select value={entity} onChange={(e) => handleEntityChange(e.target.value)} style={selectStyle}>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
              ))}
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value)} style={selectStyle}>
              {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </label>
        </div>

        {/* ── Row filters ─────────────────────────────────────────── */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Filter rows</legend>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <label style={{ ...labelStyle, flex: "1 1 140px" }}>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s === "" ? "Any" : s}</option>
                ))}
              </select>
            </label>
            <label style={{ ...labelStyle, flex: "1 1 140px" }}>
              Vendor
              <input value={vendor} onChange={(e) => setVendor(e.target.value)}
                     placeholder="e.g. Nike" style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: "1 1 140px" }}>
              Tag
              <input value={tag} onChange={(e) => setTag(e.target.value)}
                     placeholder="e.g. sale" style={inputStyle} />
            </label>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: ".75rem" }}>
            <label style={{ ...labelStyle, flex: "1 1 140px" }}>
              Created after
              <input type="date" value={createdAtMin}
                     onChange={(e) => setCreatedMin(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ ...labelStyle, flex: "1 1 140px" }}>
              Created before
              <input type="date" value={createdAtMax}
                     onChange={(e) => setCreatedMax(e.target.value)} style={inputStyle} />
            </label>
          </div>
        </fieldset>

        {/* ── Column selection ────────────────────────────────────── */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Columns to include</legend>
          <div style={{ display: "flex", gap: ".5rem", marginBottom: ".75rem" }}>
            <button type="button" onClick={() => setSelectedFields(availableFields)} style={smallBtn}>
              Select all
            </button>
            <button type="button" onClick={() => setSelectedFields([])} style={smallBtn}>
              Clear all
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: ".4rem" }}>
            {availableFields.map((field) => (
              <label key={field} style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={selectedFields.includes(field)}
                  onChange={() => toggleField(field)}
                />
                {field}
              </label>
            ))}
          </div>
        </fieldset>

        <button onClick={handleExport} disabled={isExporting || isPolling || selectedFields.length === 0}
                style={buttonStyle}>
          {isExporting ? "Starting export…" : "Export"}
        </button>

        {selectedFields.length === 0 && (
          <p style={{ color: "#b45309", fontSize: ".85rem", margin: 0 }}>
            Select at least one column to export.
          </p>
        )}

        {/* Errors */}
        {(result?.error || bulkError) && (
          <p style={{ color: "red", fontSize: ".9rem" }}>{result?.error ?? bulkError}</p>
        )}

        {/* Bulk progress */}
        {isPolling && (
          <div style={infoBox}>
            <p style={{ margin: 0, fontSize: ".9rem" }}>
              ⏳ Large store — Shopify is processing your export in the background.
              This updates automatically when ready.
            </p>
            <p style={{ margin: 0, fontSize: ".8rem", color: "#666" }}>
              Status: {pollFetcher.data?.status ?? "pending"}
              {pollFetcher.data?.rowCount ? ` · ${pollFetcher.data.rowCount.toLocaleString()} rows` : ""}
            </p>
          </div>
        )}

        {/* Download */}
        {downloadResult?.signedUrl && (
          <div style={resultBox}>
            <p style={{ margin: 0, fontSize: ".9rem" }}>Your file is ready:</p>
            <a href={downloadResult.signedUrl} download={downloadResult.filename}
               target="_blank" rel="noreferrer" style={downloadLink}>
              ↓ {downloadResult.filename}
              {downloadResult.rowCount ? ` (${downloadResult.rowCount.toLocaleString()} rows)` : ""}
            </a>
            <p style={{ margin: 0, fontSize: ".8rem", color: "#666" }}>
              Link expires at {new Date(downloadResult.expiresAt).toLocaleTimeString()}.
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
  fontSize: ".85rem", fontWeight: 500,
};
const selectStyle = {
  padding: ".5rem .75rem", borderRadius: 6,
  border: "1px solid #ccc", fontSize: ".9rem", fontWeight: 400,
};
const inputStyle = { ...selectStyle };
const buttonStyle = {
  alignSelf: "flex-start", padding: ".5rem 1.25rem",
  background: "#000", color: "#fff", borderRadius: 6,
  border: "none", fontSize: ".875rem", cursor: "pointer",
};
const smallBtn = {
  padding: ".25rem .6rem", background: "#fff", color: "#000",
  border: "1px solid #ccc", borderRadius: 5, fontSize: ".75rem", cursor: "pointer",
};
const fieldsetStyle = {
  border: "1px solid #e1e1e1", borderRadius: 8, padding: "1rem",
};
const legendStyle = { fontSize: ".85rem", fontWeight: 600, padding: "0 .4rem" };
const checkboxLabel = {
  display: "flex", alignItems: "center", gap: ".4rem",
  fontSize: ".8rem", fontWeight: 400, cursor: "pointer",
};
const resultBox = {
  display: "flex", flexDirection: "column", gap: ".5rem",
  padding: "1rem", background: "#f0fdf4", borderRadius: 8,
};
const infoBox = {
  display: "flex", flexDirection: "column", gap: ".4rem",
  padding: "1rem", background: "#fefce8", borderRadius: 8,
};
const downloadLink = { fontSize: "1rem", fontWeight: 500, color: "#000" };