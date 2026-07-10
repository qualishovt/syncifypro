/**
 * app/routes/app.scheduler.jsx
 *
 * Recurring exports & imports. Each schedule runs on its cadence (evaluated in
 * UTC) and creates a normal job, so runs appear in Recent activity with their
 * files. Export schedules pick entities + format; import schedules re-run a
 * previously uploaded file (copied to a schedule-owned R2 key so file-retention
 * cleanup doesn't remove it).
 */

import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Exportable entities offered for scheduling (common subset).
const SCHED_ENTITIES = [
  "products", "orders", "customers", "collections", "discounts",
  "draft_orders", "redirects", "pages", "blogs", "articles",
  "companies", "metaobjects", "files",
];
const FORMATS = [
  { value: "csv", label: "CSV" }, { value: "excel", label: "Excel" },
  { value: "xml", label: "XML" }, { value: "json", label: "JSON" },
];
const FREQUENCIES = [
  { value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const { listSchedules } = await import("../db/schedule.server.js");
  const { getImportJobsForShop } = await import("../db/bulkImportJob.server.js");
  const { listPresets } = await import("../db/exportPreset.server.js");
  const { listImportPresets } = await import("../db/importPreset.server.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");

  const schedules = (await listSchedules(session.shop)).map(serializeSchedule);
  const presets = (await listPresets(session.shop)).map((p) => ({ id: p.id, name: p.name, format: p.format }));
  const importPresets = (await listImportPresets(session.shop)).map((p) => ({ id: p.id, name: p.name, format: p.format }));
  const { timezone } = await getAppSettings(session.shop);

  // Import sources a schedule can re-run: recent imports whose file still exists.
  const seen = new Set();
  const importSources = [];
  for (const j of await getImportJobsForShop(session.shop, 25)) {
    if (!j.sourceR2Key || seen.has(j.filename)) continue;
    seen.add(j.filename);
    importSources.push({ jobId: j.id, filename: j.filename || "(import)", entity: j.entity, format: j.format });
  }

  return { schedules, importSources, presets, importPresets, timezone };
}

function serializeSchedule(s) {
  return {
    id: s.id, type: s.type, name: s.name, enabled: s.enabled,
    frequency: s.frequency, hour: s.hour, minute: s.minute, weekday: s.weekday, monthday: s.monthday,
    entity: s.entity, format: s.format, filename: s.filename,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
  };
}

// ─── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = fd.get("intent");

  const sched = await import("../db/schedule.server.js");

  try {
    if (intent === "delete") {
      await sched.deleteSchedule(shop, String(fd.get("id")));
      return { ok: true };
    }
    if (intent === "toggle") {
      await sched.setScheduleEnabled(shop, String(fd.get("id")), fd.get("enabled") === "true");
      return { ok: true };
    }
    if (intent === "run") {
      await sched.runScheduleNow(shop, String(fd.get("id")));
      return { ok: true, ran: true };
    }

    // intent === "create"
    const type = fd.get("type") === "import" ? "import" : "export";
    const [hour, minute] = String(fd.get("time") || "03:00").split(":").map((n) => parseInt(n, 10));
    const base = {
      shop, type,
      name: String(fd.get("name") || "").trim() || null,
      frequency: String(fd.get("frequency") || "daily"),
      hour: Number.isNaN(hour) ? 3 : hour,
      minute: Number.isNaN(minute) ? 0 : minute,
      weekday: fd.get("frequency") === "weekly" ? parseInt(String(fd.get("weekday")), 10) : null,
      monthday: fd.get("frequency") === "monthly" ? parseInt(String(fd.get("monthday")), 10) : null,
      format: String(fd.get("format") || "csv"),
    };

    if (type === "export") {
      // A saved preset carries filters + column selection; otherwise export the
      // chosen entities with all fields.
      const presetId = String(fd.get("presetId") || "");
      if (presetId) {
        const { getPreset } = await import("../db/exportPreset.server.js");
        const p = await getPreset(shop, presetId);
        if (!p) return data({ error: "That preset is no longer available." }, { status: 400 });
        let entity = "";
        try { entity = JSON.parse(p.spec).map((s) => s.entity).join(","); } catch { /* ignore */ }
        await sched.createSchedule({ ...base, format: p.format, entity, spec: p.spec });
        return { ok: true, created: true };
      }
      const entities = fd.getAll("entity").map(String).filter(Boolean);
      if (!entities.length) return data({ error: "Pick at least one entity or a preset." }, { status: 400 });
      await sched.createSchedule({ ...base, entity: entities.join(",") });
      return { ok: true, created: true };
    }

    // import: copy the chosen file to a schedule-owned R2 key so retention keeps it.
    const sourceJobId = String(fd.get("sourceJobId") || "");
    if (!sourceJobId) return data({ error: "Pick a file to re-import." }, { status: 400 });
    const { getImportJob } = await import("../db/bulkImportJob.server.js");
    const src = await getImportJob(sourceJobId);
    if (!src || src.shop !== shop || !src.sourceR2Key) {
      return data({ error: "That import file is no longer available." }, { status: 400 });
    }

    // The plan + mode to run with: a chosen import preset overrides the source
    // file's own saved setup; otherwise reuse what that file last imported with.
    let plan = src.plan ?? null;
    let options = src.options ?? null;
    const importPresetId = String(fd.get("importPresetId") || "");
    if (importPresetId) {
      const { getImportPreset } = await import("../db/importPreset.server.js");
      const p = await getImportPreset(shop, importPresetId);
      if (!p) return data({ error: "That import preset is no longer available." }, { status: 400 });
      plan = p.plan;        // already JSON strings on the preset row
      options = p.options;
    }

    const { downloadFromR2, putToR2 } = await import("../export/delivery/r2.js");
    const buffer = await downloadFromR2(src.sourceR2Key);
    const safe = String(src.filename || "import").replace(/[^\w.-]+/g, "_");
    const key = `schedules/${shop}/${Date.now()}-${safe}`;
    await putToR2({ buffer, key, mimeType: src.format === "csv" ? "text/csv" : XLSX_MIME });
    await sched.createSchedule({
      ...base, format: src.format, entity: src.entity,
      filename: src.filename, sourceR2Key: key,
      plan: plan ?? null, options: options ?? null,
    });
    return { ok: true, created: true };
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── UI ─────────────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const { schedules, importSources, presets, importPresets, timezone } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const [type, setType] = useState("export");
  const [configSource, setConfigSource] = useState("entities"); // "entities" | "preset"
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const [entities, setEntities] = useState([]);
  const [format, setFormat] = useState("csv");
  const [sourceJobId, setSourceJobId] = useState(importSources[0]?.jobId ?? "");
  const [importPresetId, setImportPresetId] = useState(""); // "" = file's own saved setup
  const [frequency, setFrequency] = useState("daily");
  const [time, setTime] = useState("03:00");
  const [weekday, setWeekday] = useState("1");
  const [monthday, setMonthday] = useState("1");
  const [name, setName] = useState("");

  const toggleEntity = (e) =>
    setEntities((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  function create() {
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("type", type);
    fd.set("format", format);
    fd.set("frequency", frequency);
    fd.set("time", time);
    fd.set("weekday", weekday);
    fd.set("monthday", monthday);
    fd.set("name", name);
    if (type === "export") {
      if (configSource === "preset" && presetId) fd.set("presetId", presetId);
      else entities.forEach((e) => fd.append("entity", e));
    } else {
      fd.set("sourceJobId", sourceJobId);
      if (importPresetId) fd.set("importPresetId", importPresetId);
    }
    fetcher.submit(fd, { method: "post" });
  }
  const act = (intent, extra = {}) =>
    fetcher.submit({ intent, ...extra }, { method: "post" });

  const usingPreset = type === "export" && configSource === "preset" && presets.length > 0;
  const canCreate = type === "export"
    ? (usingPreset ? Boolean(presetId) : entities.length > 0)
    : Boolean(sourceJobId);

  return (
    <s-page heading="Scheduler">
      <s-stack direction="block" gap="base">

        {/* ── New schedule ─────────────────────────────────────────── */}
        <s-section heading="New schedule">
          <s-stack direction="block" gap="base">

            <div style={grid2}>
              <PolarisSelect label="Type" value={type} onChange={setType}>
                <s-option value="export">Export</s-option>
                <s-option value="import">Import</s-option>
              </PolarisSelect>
              <label style={field}>
                <s-text type="strong">Name (optional)</s-text>
                <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nightly product backup" />
              </label>
            </div>

            {type === "export" ? (
              <>
                {presets.length > 0 && (
                  <div style={{ maxWidth: 300 }}>
                    <PolarisSelect label="Configuration" value={configSource} onChange={setConfigSource}>
                      <s-option value="entities">Entities (all fields)</s-option>
                      <s-option value="preset">Saved preset (with filters)</s-option>
                    </PolarisSelect>
                  </div>
                )}

                {usingPreset ? (
                  <div style={{ maxWidth: 420 }}>
                    <PolarisSelect label="Preset" value={presetId} onChange={setPresetId}>
                      {presets.map((p) => (
                        <s-option key={p.id} value={p.id}>{p.name} ({String(p.format).toUpperCase()})</s-option>
                      ))}
                    </PolarisSelect>
                    <s-text color="subdued">Runs the preset&rsquo;s entities, filters and columns. Save presets on the Export page.</s-text>
                  </div>
                ) : (
                  <>
                    <s-text type="strong">Entities</s-text>
                    <div style={chips}>
                      {SCHED_ENTITIES.map((e) => (
                        <div key={e} style={{ ...chip, ...(entities.includes(e) ? chipOn : null) }}>
                          <PolarisCheckbox
                            label={titleCase(e)}
                            checked={entities.includes(e)}
                            onChange={() => toggleEntity(e)}
                          />
                        </div>
                      ))}
                    </div>
                    <div style={{ maxWidth: 220 }}>
                      <PolarisSelect label="Format" value={format} onChange={setFormat}>
                        {FORMATS.map((f) => <s-option key={f.value} value={f.value}>{f.label}</s-option>)}
                      </PolarisSelect>
                    </div>
                    {presets.length === 0 && (
                      <s-text color="subdued">Tip: save a preset on the Export page to schedule a filtered export.</s-text>
                    )}
                  </>
                )}
              </>
            ) : (
              <div style={{ maxWidth: 420 }}>
                {importSources.length === 0 ? (
                  <s-banner tone="info">No uploaded import files yet. Run an import first, then schedule it here.</s-banner>
                ) : (
                  <s-stack direction="block" gap="small">
                    <PolarisSelect label="Re-import file" value={sourceJobId} onChange={setSourceJobId}>
                      {importSources.map((s) => (
                        <s-option key={s.jobId} value={s.jobId}>{s.filename} ({String(s.format).toUpperCase()})</s-option>
                      ))}
                    </PolarisSelect>
                    <PolarisSelect label="Import setup" value={importPresetId} onChange={setImportPresetId}>
                      <s-option value="">Use the file&rsquo;s original setup</s-option>
                      {importPresets.map((p) => (
                        <s-option key={p.id} value={p.id}>Preset: {p.name}</s-option>
                      ))}
                    </PolarisSelect>
                    <s-text color="subdued">
                      The setup is the per-sheet plan (entity, filters, columns) and import mode. Save presets on the Import page.
                    </s-text>
                  </s-stack>
                )}
              </div>
            )}

            {/* Cadence */}
            <div style={grid2}>
              <PolarisSelect label="Frequency" value={frequency} onChange={setFrequency}>
                {FREQUENCIES.map((f) => <s-option key={f.value} value={f.value}>{f.label}</s-option>)}
              </PolarisSelect>
              {frequency !== "hourly" && (
                <label style={field}>
                  <s-text type="strong">Time (UTC)</s-text>
                  <input type="time" style={input} value={time} onChange={(e) => setTime(e.target.value)} />
                </label>
              )}
              {frequency === "weekly" && (
                <PolarisSelect label="Day of week" value={weekday} onChange={setWeekday}>
                  {WEEKDAYS.map((w, i) => <s-option key={i} value={String(i)}>{w}</s-option>)}
                </PolarisSelect>
              )}
              {frequency === "monthly" && (
                <label style={field}>
                  <s-text type="strong">Day of month (1–28)</s-text>
                  <input type="number" min="1" max="28" style={input} value={monthday} onChange={(e) => setMonthday(e.target.value)} />
                </label>
              )}
            </div>

            <s-stack direction="inline" gap="small" alignment="center">
              <s-button variant="primary" onClick={create} disabled={busy || !canCreate} loading={busy ? true : undefined}>
                Create schedule
              </s-button>
              {fetcher.data?.error && <s-text color="critical">{fetcher.data.error}</s-text>}
            </s-stack>
          </s-stack>
        </s-section>

        {/* ── Existing schedules ───────────────────────────────────── */}
        <s-section heading="Schedules">
          {schedules.length === 0 ? (
            <s-paragraph>No schedules yet. Create one above to run exports/imports automatically.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {schedules.map((s) => (
                <div key={s.id} style={{ ...card, opacity: s.enabled ? 1 : 0.6 }}>
                  <div style={cardHead}>
                    <s-stack direction="inline" gap="small" alignment="center">
                      <s-badge tone={s.type === "export" ? "success" : "info"}>{titleCase(s.type)}</s-badge>
                      <s-text type="strong">{s.name || describeWhat(s)}</s-text>
                      {!s.enabled && <s-badge tone="warning">Paused</s-badge>}
                    </s-stack>
                    <s-stack direction="inline" gap="small" alignment="center">
                      <s-button onClick={() => act("run", { id: s.id })} disabled={busy}>Run now</s-button>
                      <s-button onClick={() => act("toggle", { id: s.id, enabled: String(!s.enabled) })} disabled={busy}>
                        {s.enabled ? "Pause" : "Resume"}
                      </s-button>
                      <s-button tone="critical" onClick={() => act("delete", { id: s.id })} disabled={busy}>Delete</s-button>
                    </s-stack>
                  </div>
                  <s-text color="subdued">
                    {describeWhat(s)} · {describeCadence(s)}
                    {s.nextRunAt ? ` · next ${fmt(s.nextRunAt, timezone)}` : ""}
                    {s.lastRunAt ? ` · last ${fmt(s.lastRunAt, timezone)}` : ""}
                  </s-text>
                </div>
              ))}
            </s-stack>
          )}
        </s-section>

      </s-stack>
    </s-page>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function titleCase(s) {
  return String(s ?? "").split(/[,_]/).map((w) => w.trim()).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(", ");
}
function describeWhat(s) {
  if (s.type === "import") return `Re-import ${s.filename || "file"} (${String(s.format).toUpperCase()})`;
  return `Export ${titleCase(s.entity)} as ${String(s.format).toUpperCase()}`;
}
function describeCadence(s) {
  const t = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} UTC`;
  if (s.frequency === "hourly") return `Hourly at :${String(s.minute).padStart(2, "0")}`;
  if (s.frequency === "daily") return `Daily at ${t}`;
  if (s.frequency === "weekly") return `Weekly on ${WEEKDAYS[s.weekday ?? 1]} at ${t}`;
  if (s.frequency === "monthly") return `Monthly on day ${s.monthday ?? 1} at ${t}`;
  return s.frequency;
}
function fmt(iso, tz = "UTC") {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz || "UTC", timeZoneName: "short",
  });
}

// ─── styles ──────────────────────────────────────────────────────────────────

const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", alignItems: "end" };
const field = { display: "flex", flexDirection: "column", gap: ".35rem" };
const input = { padding: ".45rem .6rem", borderRadius: 6, border: "1px solid #c9cccf", fontSize: ".9rem", background: "#fff" };
const chips = { display: "flex", flexWrap: "wrap", gap: ".4rem" };
const chip = { display: "inline-flex", alignItems: "center", gap: ".35rem", padding: ".25rem .6rem", borderRadius: 999, border: "1px solid #c9cccf", background: "#fff", fontSize: ".85rem", cursor: "pointer" };
const chipOn = { background: "#f1f6fe", borderColor: "#2c6ecb" };
const card = { border: "1px solid #e1e3e5", borderRadius: 10, padding: ".85rem 1rem", background: "#fff" };
const cardHead = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: ".35rem" };
