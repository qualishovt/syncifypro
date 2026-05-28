/**
 * app/routes/app.import.jsx
 *
 * Handles all entity imports. The merchant picks an entity,
 * uploads a file, and sees a per-row result summary.
 */

import { data } from "react-router";
import { useActionData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server.js";
import { runImportJob } from "../import/importJob.js";

// ─── Action: handle file upload ───────────────────────────────────────────────

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const file   = formData.get("file");
  const format = formData.get("format") ?? "csv";
  const entity = formData.get("entity") ?? "products";

  if (!file || typeof file === "string") {
    return data({ error: "No file uploaded." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const result = await runImportJob({ fileBuffer, format, entity, admin });

  return result;
}

// ─── UI ──────────────────────────────────────────────────────────────────────

const ENTITIES = ["products", "orders", "collections", "discounts", "customers"];
const FORMATS  = ["csv", "excel", "xml", "json"];

export default function ImportPage() {
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 500, marginBottom: "2rem" }}>Import</h1>

      <Form method="post" encType="multipart/form-data">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Entity picker */}
          <label style={labelStyle}>
            Entity
            <select name="entity" defaultValue="products" style={selectStyle}>
              {ENTITIES.map((e) => (
                <option key={e} value={e}>
                  {e.charAt(0).toUpperCase() + e.slice(1)}
                </option>
              ))}
            </select>
          </label>

          {/* Format picker */}
          <label style={labelStyle}>
            Format
            <select name="format" defaultValue="csv" style={selectStyle}>
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </label>

          {/* File upload */}
          <label style={labelStyle}>
            File
            <input
              type="file"
              name="file"
              accept=".csv,.xlsx,.xml,.json"
              required
              style={{ fontSize: ".9rem" }}
            />
          </label>

          <button type="submit" disabled={isSubmitting} style={buttonStyle}>
            {isSubmitting ? "Importing…" : "Import"}
          </button>

        </div>
      </Form>

      {/* Error */}
      {actionData?.error && (
        <p style={{ color: "red", marginTop: "1rem" }}>{actionData.error}</p>
      )}

      {/* Results summary */}
      {actionData?.parsed !== undefined && (
        <div style={{ marginTop: "1.5rem", fontSize: ".9rem" }}>
          <p>Rows parsed: <strong>{actionData.parsed}</strong></p>
          <p>
            Valid: <strong>{actionData.valid}</strong> &nbsp;|&nbsp;
            Invalid: <strong>{actionData.invalid}</strong>
          </p>
          <p>
            Created: <strong>{actionData.created}</strong> &nbsp;|&nbsp;
            Updated: <strong>{actionData.updated}</strong>
          </p>

          {actionData.validationErrors?.length > 0 && (
            <details style={{ marginTop: "1rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 500 }}>
                Validation errors ({actionData.validationErrors.length})
              </summary>
              <ul style={{ marginTop: ".5rem", paddingLeft: "1.2rem" }}>
                {actionData.validationErrors.map((e, i) => (
                  <li key={i} style={{ color: "red" }}>
                    Row {e.row} — <strong>{e.field}</strong>: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {actionData.writeErrors?.length > 0 && (
            <details style={{ marginTop: ".75rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 500 }}>
                Shopify write errors ({actionData.writeErrors.length})
              </summary>
              <ul style={{ marginTop: ".5rem", paddingLeft: "1.2rem" }}>
                {actionData.writeErrors.map((e, i) => (
                  <li key={i} style={{ color: "red" }}>
                    {e.product}: {e.message ?? JSON.stringify(e.userErrors)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: ".4rem",
  fontSize: ".9rem",
  fontWeight: 500,
};

const selectStyle = {
  padding: ".5rem .75rem",
  borderRadius: 6,
  border: "1px solid #ccc",
  fontSize: ".9rem",
  fontWeight: 400,
};

const buttonStyle = {
  alignSelf: "flex-start",
  padding: ".5rem 1.25rem",
  background: "#000",
  color: "#fff",
  borderRadius: 6,
  border: "none",
  fontSize: ".875rem",
  cursor: "pointer",
};