/**
 * app/routes/app.scheduler.jsx
 *
 * Scheduler — mirrored from ReportifyPro's scheduler: Schedules / Schedule
 * history tabs, a schedules table (switch + run/edit/delete icon actions), an
 * edit-in-place form with per-destination delivery tabs (Email, FTP, Google
 * Drive, Google Sheets, Amazon S3) and a paginated run history.
 *
 * A schedule runs an export (entities or a saved preset) or re-runs an import
 * file on its cadence; the produced file is delivered to every enabled
 * destination and the run is recorded in ScheduleRun.
 */

import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigation, useSubmit, useActionData, useRevalidator } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server.js";
import { useNavigate, PrefetchPageLinks } from "react-router";
import { parseImportUrl, filenameFromUrl, sniffFormat, buildRemoteUrl } from "../import/urlSource.js";
import { isEntityBlocked } from "../export/fieldLists.js";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisTextField from "../components/PolarisTextField.jsx";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";
import FormatIcon from "../components/FormatIcon.jsx";
import { timezoneChoices, timezoneLabel } from "../utils/timezones.js";

// Exportable entities offered for scheduling — the SAME list as the Export
// page, so anything exportable is schedulable (Sheet Permissions still hides
// blocked ones via the loader's blockedEntities).
const SCHED_ENTITIES = [
  "products", "orders", "customers", "collections", "smart_collections",
  "custom_collections", "discounts", "content", "articles", "draft_orders",
  "gift_cards", "redirects", "product_media", "inventory", "selling_plans",
  "metafields", "segments", "store_credit", "markets", "delivery_profiles",
  "shop", "files", "payouts", "menus", "companies", "locations", "catalogs",
  "inventory_transfers", "activity", "metaobjects", "definitions", "translations",
];
// Same set and order as the Export page's Format picker.
const FORMATS = [
  { value: "excel", label: "Excel" }, { value: "csv", label: "CSV" },
  { value: "xml", label: "XML" }, { value: "json", label: "JSON" },
  { value: "pdf", label: "PDF" }, { value: "csv_shopify", label: "Shopify CSV" },
];

/** "" / garbage → null (one file); a positive integer → split size. */
function parseSplit(raw) {
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const FREQUENCIES = [
  { value: "every15min", label: "Every 15 minutes" },
  { value: "every30min", label: "Every 30 minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Delivery destinations (a schedule can have several enabled at once).
const DESTINATIONS = [
  { key: "email", label: "Email" },
  { key: "ftp", label: "FTP" },
  { key: "gdrive", label: "Google Drive" },
  { key: "gsheets", label: "Google Sheets" },
  { key: "s3", label: "Amazon S3" },
];

// ─── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const sched = await import("../db/schedule.server.js");
  const { listPresets } = await import("../db/exportPreset.server.js");
  const { listImportPresets } = await import("../db/importPreset.server.js");
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const google = await import("../schedules/google.server.js");
  // The app's Settings → Time zone is the default for new schedules, so
  // "08:00" means 08:00 on the clock the merchant chose there.
  const { blockedEntities, timezone: shopTimezone } = await getAppSettings(session.shop);

  const schedules = (await sched.listSchedules(session.shop)).map((s) => serializeSchedule(s, sched));
  const history = (await sched.listScheduleRuns(session.shop, 100)).map((h) => ({
    id: h.id,
    scheduleName: h.scheduleName,
    task: h.task,
    status: h.status,
    rows: h.rows,
    delivery: h.delivery,
    message: h.message,
    runAt: h.runAt.toISOString(),
  }));
  const presets = (await listPresets(session.shop)).map((p) => ({ id: p.id, name: p.name, format: p.format }));
  const importPresets = (await listImportPresets(session.shop)).map((p) => ({ id: p.id, name: p.name }));
  const { listImportServers, serializeImportServer } = await import("../db/importServer.server.js");
  const servers = (await listImportServers(session.shop)).map(serializeImportServer);

  const conn = await google.getConnection(session.shop);
  return {
    schedules, history, presets, importPresets, servers,
    blockedEntities: blockedEntities ?? [],
    shop: session.shop,
    shopTimezone: shopTimezone || "UTC",
    google: {
      configured: google.googleConfigured(),
      connected: Boolean(conn?.refreshToken),
      email: conn?.email || "",
    },
    // Email delivery needs a Resend key on the server; without it sends are
    // skipped, so the UI must say so instead of letting merchants rely on it.
    emailConfigured: (await import("../schedules/mailer.server.js")).emailConfigured(),
  };
}

function serializeSchedule(s, sched) {
  return {
    id: s.id, type: s.type, name: s.name || "", enabled: s.enabled,
    frequency: s.frequency, hour: s.hour, minute: s.minute,
    weekday: s.weekday ?? 1, monthday: s.monthday ?? 1,
    timezone: s.timezone || "UTC",
    entity: s.entity, format: s.format, filename: s.filename,
    sourceUrl: s.sourceUrl || "",
    onlyNewFiles: s.onlyNewFiles ?? true,
    hasSpec: Boolean(s.spec),
    splitRows: s.splitRows ?? null,
    task: sched.describeTask(s),
    destinations: sched.serializeDestinations(s),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    nextRunAt: s.nextRunAt ? s.nextRunAt.toISOString() : null,
  };
}

// ─── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "save");
  const sched = await import("../db/schedule.server.js");

  try {
    // Schedules are a Pro feature; delete/disable/disconnect stay available so
    // a downgraded merchant can clean up.
    const enablesToggle = intent === "toggle" && fd.get("enabled") === "true";
    if (["run", "save"].includes(intent) || enablesToggle) {
      const { getPlan, upgradeError } = await import("../billing.server.js");
      const plan = await getPlan(admin);
      if (!plan.schedules) return data(upgradeError("Scheduling", session.shop), { status: 402 });
    }
    if (intent === "delete") {
      await sched.deleteSchedule(shop, String(fd.get("id")));
      return { ok: true };
    }
    if (intent === "toggle") {
      await sched.setScheduleEnabled(shop, String(fd.get("id")), fd.get("enabled") === "true");
      return { ok: true };
    }
    if (intent === "run") {
      const run = await sched.runScheduleNow(shop, String(fd.get("id")));
      if (!run) return { ok: false, error: "Schedule not found." };
      return { ok: run.ok, run };
    }
    if (intent === "google_disconnect") {
      const { disconnectGoogle } = await import("../schedules/google.server.js");
      await disconnectGoogle(shop);
      return { ok: true };
    }

    // intent === "save" — create (no id) or update.
    const id = String(fd.get("id") || "");
    const name = String(fd.get("name") || "").trim();
    if (!name) return data({ error: "A schedule name is required." }, { status: 400 });

    const clamp = (v, lo, hi, dflt) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
    };
    const timezone = String(fd.get("timezone") || "UTC").trim();
    if (!sched.isValidTimezone(timezone)) {
      return data({
        error: `Unknown timezone "${timezone}" — use an IANA name such as Europe/London or America/New_York.`,
      }, { status: 400 });
    }
    const base = {
      name,
      frequency: String(fd.get("frequency") || "daily"),
      hour: clamp(fd.get("hour"), 0, 23, 8),
      minute: clamp(fd.get("minute"), 0, 59, 0),
      weekday: clamp(fd.get("weekday"), 0, 6, 1),
      monthday: clamp(fd.get("monthday"), 1, 28, 1),
      timezone,
      destinations: String(fd.get("destinations") || ""),
      enabled: fd.get("enabled") !== "false",
    };

    if (id) {
      // ── update ────────────────────────────────────────────────────────────
      const patch = { ...base, format: String(fd.get("format") || "csv") };
      const type = String(fd.get("type") || "export");
      if (type === "export") {
        patch.filename = String(fd.get("filenameTemplate") || "").trim() || null;
        patch.splitRows = parseSplit(fd.get("splitRows"));
        if (fd.get("hasSpec") !== "true") {
          const entities = fd.getAll("entity").map(String).filter(Boolean);
          if (!entities.length) return data({ error: "Pick at least one entity." }, { status: 400 });
          patch.entity = entities.join(",");
        }
      }
      if (type === "import") {
        delete patch.format; // an import's format comes from its file
        patch.onlyNewFiles = fd.get("onlyNewFiles") !== "false";
        const sourceUrl = String(fd.get("sourceUrl") || "").trim();
        if (sourceUrl) {
          const parsed = parseImportUrl(sourceUrl);
          if (!parsed.ok) return data({ error: parsed.error }, { status: 400 });
          patch.sourceUrl = parsed.url.toString();
          patch.filename = filenameFromUrl(parsed.url) || "import";
        }
        const importPresetId = String(fd.get("importPresetId") || "");
        if (importPresetId) {
          const { getImportPreset } = await import("../db/importPreset.server.js");
          const p = await getImportPreset(shop, importPresetId);
          if (!p) return data({ error: "That import preset is no longer available." }, { status: 400 });
          patch.plan = p.plan;
          patch.options = p.options;
        }
      }
      const updated = await sched.updateSchedule(shop, id, patch);
      if (!updated) return data({ error: "Schedule not found." }, { status: 404 });
      return { ok: true };
    }

    // ── create ────────────────────────────────────────────────────────────────
    const type = fd.get("type") === "import" ? "import" : "export";

    if (type === "export") {
      const filename = String(fd.get("filenameTemplate") || "").trim() || null;
      const splitRows = parseSplit(fd.get("splitRows"));
      const presetId = String(fd.get("presetId") || "");
      if (presetId) {
        const { getPreset } = await import("../db/exportPreset.server.js");
        const p = await getPreset(shop, presetId);
        if (!p) return data({ error: "That preset is no longer available." }, { status: 400 });
        let entity = "";
        try { entity = JSON.parse(p.spec).map((x) => x.entity).join(","); } catch { /* ignore */ }
        // The preset carries the split setting, the Advanced options AND the
        // file name — all snapshotted onto the schedule, like the spec.
        let popts = {};
        try { popts = p.options ? JSON.parse(p.options) ?? {} : {}; } catch { /* ignore */ }
        await sched.createSchedule({
          ...base, shop, type, format: p.format, entity, spec: p.spec,
          filename: popts.filename ?? null,
          splitRows: p.splitRows ?? null,
          options: p.options ?? null,
        });
        return { ok: true };
      }
      const entities = fd.getAll("entity").map(String).filter(Boolean);
      if (!entities.length) return data({ error: "Pick at least one entity or a preset." }, { status: 400 });
      await sched.createSchedule({
        ...base, shop, type,
        format: String(fd.get("format") || "csv"),
        entity: entities.join(","),
        filename,
        splitRows,
      });
      return { ok: true };
    }

    // import: the schedule stores a source URL, fetched FRESH on every run
    // (credentials resolve through saved Import Servers by protocol + host).
    const sourceUrl = String(fd.get("sourceUrl") || "").trim();
    const parsed = parseImportUrl(sourceUrl);
    if (!parsed.ok) return data({ error: parsed.error }, { status: 400 });

    let plan = null;
    let options = null;
    const importPresetId = String(fd.get("importPresetId") || "");
    if (importPresetId) {
      const { getImportPreset } = await import("../db/importPreset.server.js");
      const p = await getImportPreset(shop, importPresetId);
      if (!p) return data({ error: "That import preset is no longer available." }, { status: 400 });
      plan = p.plan;
      options = p.options;
    }

    const filename = filenameFromUrl(parsed.url) || "import";
    await sched.createSchedule({
      ...base, shop, type,
      format: sniffFormat({ filename }) ?? "csv", // display; each run re-sniffs the fetched file
      entity: "",
      filename,
      sourceUrl: parsed.url.toString(),
      onlyNewFiles: fd.get("onlyNewFiles") !== "false",
      plan, options,
    });
    return { ok: true };
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

const fmtDateTime = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

// nextRunAt is a UTC instant; show it on the schedule's own clock. The zone
// is rendered on its own line so the label never widens the column.
const fmtInTz = (iso, tz) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: tz || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    return fmtDateTime(iso);
  }
};

function scheduleSummary(s) {
  const t = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  switch (s.frequency) {
    case "every15min":
      return "Every 15 minutes";
    case "every30min":
      return "Every 30 minutes";
    case "hourly":
      return `Hourly at :${String(s.minute).padStart(2, "0")}`;
    case "weekly":
      return `Weekly · ${WEEKDAYS[s.weekday]} · ${t}`;
    case "monthly":
      return `Monthly · day ${s.monthday} · ${t}`;
    case "quarterly":
      return `Quarterly · day ${s.monthday} · ${t}`;
    default:
      return `Daily · ${t}`;
  }
}

// ── Popover-picker helpers (same pattern as the run page's Deliver-to) ──────

/** Measure an element's width (for popovers matched to their trigger). */
function useElementWidth() {
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

function widthProps(w) {
  if (!w) return {};
  return { inlineSize: `${w}px`, minInlineSize: `${w}px`, maxInlineSize: `${w}px` };
}

/* eslint-disable react/prop-types */
// Row inside a picker popover: check slot → optional icon → label.
function PickerRow({ label, icon, selected, onSelect, popoverId }) {
  return (
    <s-clickable
      onClick={onSelect}
      command="--hide"
      commandFor={popoverId}
      padding="small-200"
      borderRadius="base"
      {...(selected ? { background: "subdued" } : {})}
    >
      <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
        <span style={checkSlot}>{selected ? <s-icon type="check" /> : null}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", ...(selected ? { fontWeight: 700 } : null) }}>
          {icon}
          {label}
        </span>
      </s-grid>
    </s-clickable>
  );
}
/* eslint-enable react/prop-types */

// Reserved left column in picker rows so the checkmark aligns all labels.
const checkSlot = {
  width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
};
// Small field label above the picker trigger (Polaris label rhythm).
const pickerLabel = {
  display: "block", fontSize: ".8125rem", fontWeight: 450, marginBottom: ".25rem",
};

// Commas separate entities; underscores are word breaks within one entity —
// "product_media" → "Product media", "products,orders" → "Products, Orders".
const titleCase = (s) =>
  String(s ?? "").split(",").map((e) => e.trim()).filter(Boolean)
    .map((e) => {
      const words = e.split("_").join(" ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(", ");

/** Reverse of buildRemoteUrl for editing: match a stored URL to a saved server. */
function splitSourceUrl(url, servers) {
  for (const s of servers) {
    const prefix = buildRemoteUrl(s, "");
    if (url && prefix && url.startsWith(prefix)) {
      return { sourceServerId: s.id, sourcePath: url.slice(prefix.length).replace(/^\/+/, "") };
    }
  }
  return { sourceServerId: "", sourcePath: url || "" };
}

const BLANK = {
  id: "",
  type: "export",
  name: "",
  hasSpec: false,
  configSource: "entities", // "entities" | "preset"
  presetId: "",
  entities: [],
  sourceServerId: "", // "" = Direct URL
  sourcePath: "",     // full URL in direct mode; path on the server otherwise
  onlyNewFiles: true,
  importPresetId: "",
  filenameTemplate: "", // export delivery filename, {date} {time} {shop} {name}
  splitRows: "",       // split export into files of N records
  format: "csv",
  frequency: "daily",
  hour: "8",
  minute: "0",
  weekday: "1",
  monthday: "1",
  timezone: "UTC",
  // Destinations — each can be enabled independently.
  emailOn: false,
  recipients: "",
  ftpOn: false,
  ftpServerId: "", // saved server from the Servers page ("" = manual details)
  ftpProtocol: "ftp",
  ftpHost: "",
  ftpPort: "21",
  ftpUser: "",
  ftpPassword: "",
  ftpPath: "",
  driveOn: false,
  gdrive: "",
  sheetsOn: false,
  gsheet: "",
  gsheetFolder: "",
  s3On: false,
  s3ServerId: "", // saved server from the Servers page ("" = manual details)
  s3Bucket: "",
  s3Region: "us-east-1",
  s3AccessKeyId: "",
  s3SecretAccessKey: "",
  s3Prefix: "",
  s3Endpoint: "",
  enabled: true,
};

// ─── UI ─────────────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const { schedules, history, presets, importPresets, servers, google, shop, shopTimezone, blockedEntities, emailConfigured } = useLoaderData();
  const navigate = useNavigate();

  // Sheet Permissions (Settings): entities blocked there are hidden here too,
  // matching the Export page (including parent gating for the split tiles).
  const visibleEntities = SCHED_ENTITIES.filter((e) => !isEntityBlocked(e, blockedEntities));
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const rowFetcher = useFetcher();
  const revalidator = useRevalidator();
  const saving = navigation.state !== "idle";

  // When the Google OAuth popup finishes it posts a message back; re-fetch the
  // loader so the "Google connected" status updates without a manual reload.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin === window.location.origin && e.data?.type === "syncify:google-connected") {
        revalidator.revalidate();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [revalidator]);

  const [form, setForm] = useState(BLANK);
  const [tab, setTab] = useState("schedules"); // "schedules" | "history"
  const [showForm, setShowForm] = useState(false);
  const [deliveryTab, setDeliveryTab] = useState("email"); // active destination panel
  const [historyPage, setHistoryPage] = useState(1);
  const [runDismissed, setRunDismissed] = useState(false);
  const [errDismissed, setErrDismissed] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // A new run result / form error un-dismisses its alert so it shows again.
  useEffect(() => setRunDismissed(false), [rowFetcher.data]);
  useEffect(() => setErrDismissed(false), [actionData]);

  const HIST_PAGE = 10;
  const histPages = Math.max(1, Math.ceil(history.length / HIST_PAGE));
  const histSlice = history.slice((historyPage - 1) * HIST_PAGE, historyPage * HIST_PAGE);

  // Hide and reset the form after a successful save/create.
  useEffect(() => {
    if (actionData?.ok && navigation.state === "idle") {
      setForm(BLANK);
      setShowForm(false);
    }
  }, [actionData, navigation.state]);

  const openNew = () => {
    setForm({ ...BLANK, presetId: presets[0]?.id ?? "", timezone: shopTimezone || "UTC" });
    setTab("schedules");
    setShowForm(true);
  };
  const closeForm = () => {
    setForm(BLANK);
    setShowForm(false);
  };

  const editing = form.id !== "";

  const startEdit = (s) => {
    const d = s.destinations || {};
    setForm({
      ...BLANK,
      id: s.id,
      type: s.type,
      name: s.name,
      hasSpec: s.hasSpec,
      ...splitSourceUrl(s.sourceUrl || "", servers),
      onlyNewFiles: s.onlyNewFiles ?? true,
      filenameTemplate: s.type === "export" ? (s.filename || "") : "",
      splitRows: s.splitRows != null ? String(s.splitRows) : "",
      entities: String(s.entity || "").split(",").map((x) => x.trim()).filter(Boolean),
      format: s.format,
      frequency: s.frequency,
      hour: String(s.hour),
      minute: String(s.minute),
      weekday: String(s.weekday),
      monthday: String(s.monthday),
      timezone: s.timezone,
      emailOn: Boolean(d.email?.enabled),
      recipients: d.email?.recipients || "",
      ftpOn: Boolean(d.ftp?.enabled),
      ftpServerId: d.ftp?.serverId || "",
      ftpProtocol: d.ftp?.protocol || "ftp",
      ftpHost: d.ftp?.host || "",
      ftpPort: String(d.ftp?.port || "21"),
      ftpUser: d.ftp?.user || "",
      ftpPassword: d.ftp?.password || "",
      ftpPath: d.ftp?.path || "",
      driveOn: Boolean(d.gdrive?.enabled),
      gdrive: d.gdrive?.folderId || "",
      sheetsOn: Boolean(d.gsheets?.enabled),
      gsheet: d.gsheets?.name || "",
      gsheetFolder: d.gsheets?.folderId || "",
      s3On: Boolean(d.s3?.enabled),
      s3ServerId: d.s3?.serverId || "",
      s3Bucket: d.s3?.bucket || "",
      s3Region: d.s3?.region || "us-east-1",
      s3AccessKeyId: d.s3?.accessKeyId || "",
      s3SecretAccessKey: d.s3?.secretAccessKey || "",
      s3Prefix: d.s3?.prefix || "",
      s3Endpoint: d.s3?.endpoint || "",
      enabled: s.enabled,
    });
    setTab("schedules");
    setShowForm(true);
  };

  const save = () => {
    const destinations = JSON.stringify({
      email: { enabled: form.emailOn, recipients: form.recipients },
      ftp: {
        enabled: form.ftpOn,
        serverId: form.ftpServerId,
        protocol: form.ftpProtocol,
        host: form.ftpHost,
        port: form.ftpPort,
        user: form.ftpUser,
        password: form.ftpPassword,
        path: form.ftpPath,
      },
      gdrive: { enabled: form.driveOn, folderId: form.gdrive },
      gsheets: { enabled: form.sheetsOn, name: form.gsheet, folderId: form.gsheetFolder },
      s3: {
        enabled: form.s3On,
        serverId: form.s3ServerId,
        bucket: form.s3Bucket,
        region: form.s3Region,
        accessKeyId: form.s3AccessKeyId,
        secretAccessKey: form.s3SecretAccessKey,
        prefix: form.s3Prefix,
        endpoint: form.s3Endpoint,
      },
    });
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("id", form.id);
    fd.set("type", form.type);
    fd.set("name", form.name);
    fd.set("hasSpec", String(form.hasSpec));
    fd.set("format", form.format);
    fd.set("frequency", form.frequency);
    fd.set("hour", form.hour);
    fd.set("minute", form.minute);
    fd.set("weekday", form.weekday);
    fd.set("monthday", form.monthday);
    fd.set("timezone", form.timezone);
    fd.set("destinations", destinations);
    fd.set("enabled", String(form.enabled));
    if (form.type === "export") {
      fd.set("filenameTemplate", form.filenameTemplate.trim());
      fd.set("splitRows", form.splitRows.trim());
      if (usingPreset) fd.set("presetId", form.presetId);
      else form.entities.forEach((e) => fd.append("entity", e));
    } else {
      fd.set("sourceUrl", effectiveSourceUrl.trim());
      fd.set("onlyNewFiles", String(form.onlyNewFiles));
      if (form.importPresetId) fd.set("importPresetId", form.importPresetId);
    }
    submit(fd, { method: "post" });
  };

  const remove = (id) =>
    rowFetcher.submit({ intent: "delete", id: String(id) }, { method: "post" });
  const toggle = (id, enabled) =>
    rowFetcher.submit({ intent: "toggle", id: String(id), enabled: String(enabled) }, { method: "post" });
  const runNow = (id) => rowFetcher.submit({ intent: "run", id: String(id) }, { method: "post" });
  const disconnectGoogleNow = () =>
    rowFetcher.submit({ intent: "google_disconnect" }, { method: "post" });

  // Which row's "Run now" is currently in flight (from the fetcher's form data).
  const runningId =
    rowFetcher.state !== "idle" && rowFetcher.formData?.get("intent") === "run"
      ? rowFetcher.formData.get("id")
      : null;

  const lastRun = rowFetcher.data?.run;
  const runMessage = lastRun
    ? lastRun.error
      ? `Run failed: ${lastRun.error}.`
      : `Ran ${lastRun.rows} record(s). ${lastRun.delivery || ""}`
    : null;

  const toggleEntity = (e) =>
    set({ entities: form.entities.includes(e) ? form.entities.filter((x) => x !== e) : [...form.entities, e] });

  const usingPreset = !editing && form.type === "export" && form.configSource === "preset" && presets.length > 0;
  const sourceServer = servers.find((s) => s.id === form.sourceServerId) ?? null;
  // Saved servers usable as delivery targets, per destination tab.
  const ftpServers = servers.filter((s) => ["ftp", "ftps", "sftp"].includes(s.protocol));
  const s3Servers = servers.filter((s) => s.protocol === "s3");
  // FTP server picker popover: spinner while navigating to Servers, and the
  // popover matched to its trigger's width.
  const [addingServer, setAddingServer] = useState(false);
  const [ftpTriggerRef, ftpTriggerWidth] = useElementWidth();
  const [formatTriggerRef, formatTriggerWidth] = useElementWidth();
  const effectiveSourceUrl = buildRemoteUrl(sourceServer, form.sourcePath);
  const sourceUrlOk = parseImportUrl(effectiveSourceUrl).ok;
  const canSave = form.type === "export"
    ? (usingPreset ? Boolean(form.presetId) : (form.hasSpec || form.entities.length > 0))
    : (editing ? (!effectiveSourceUrl.trim() || sourceUrlOk) : sourceUrlOk);
  const googleNeeded = form.driveOn || form.sheetsOn;
  const destEnabled = {
    email: form.emailOn,
    ftp: form.ftpOn,
    gdrive: form.driveOn,
    gsheets: form.sheetsOn,
    s3: form.s3On,
  };
  const enabledDestLabels = (d) =>
    DESTINATIONS.filter((x) => d?.[x.key]?.enabled).map((x) => x.label).join(", ") || "—";

  // Shared Google connection status / connect button (Drive + Sheets use one account).
  const googleConnect = google.connected ? (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-badge tone="success">
        Google connected{google.email ? ` (${google.email})` : ""}
      </s-badge>
      <s-button variant="tertiary" tone="critical" onClick={disconnectGoogleNow}>
        Disconnect
      </s-button>
    </s-stack>
  ) : google.configured ? (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-button
        icon="external"
        onClick={() =>
          window.open(`/google/auth?shop=${encodeURIComponent(shop)}`, "syncify-google", "width=520,height=640")
        }
      >
        Connect Google
      </s-button>
    </s-stack>
  ) : (
    <s-banner tone="warning">
      Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI to enable Google delivery.
    </s-banner>
  );

  return (
    <s-page heading="Schedules">
      <s-section>
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-text color="subdued">
            Automate exports and imports, delivered by email, FTP/SFTP, Google Drive/Sheets or Amazon S3.
          </s-text>
        </s-stack>
      </s-section>
      <s-section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <s-stack direction="inline" gap="small-300">
            <s-button
              variant={tab === "schedules" ? "primary" : "tertiary"}
              onClick={() => setTab("schedules")}
            >
              Schedules
            </s-button>
            <s-button
              variant={tab === "history" ? "primary" : "tertiary"}
              onClick={() => setTab("history")}
            >
              Schedule history
            </s-button>
          </s-stack>
          {tab === "schedules" && (
            <s-button variant="primary" icon="plus" onClick={openNew}>
              New
            </s-button>
          )}
        </div>
      </s-section>

      {tab === "schedules" && (
        <s-section heading="Schedules">
          {runMessage && !runDismissed && (
            <s-banner
              tone={lastRun?.ok ? "success" : "critical"}
              dismissible
              onDismiss={() => setRunDismissed(true)}
            >
              {runMessage}
            </s-banner>
          )}

          {schedules.length === 0 ? (
            <s-paragraph>No schedules yet. Click “New” to add one.</s-paragraph>
          ) : (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Name</s-table-header>
                <s-table-header>Task</s-table-header>
                <s-table-header>Schedule</s-table-header>
                <s-table-header>Format</s-table-header>
                <s-table-header>Delivery</s-table-header>
                <s-table-header>Next run</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {schedules.map((s) => (
                  <s-table-row key={s.id}>
                    <s-table-cell>{s.name || "—"}</s-table-cell>
                    <s-table-cell>{s.task}</s-table-cell>
                    <s-table-cell>{scheduleSummary(s)}</s-table-cell>
                    <s-table-cell>{String(s.format).toUpperCase()}</s-table-cell>
                    <s-table-cell>{enabledDestLabels(s.destinations)}</s-table-cell>
                    <s-table-cell>
                      <div style={{ whiteSpace: "nowrap" }}>{fmtInTz(s.nextRunAt, s.timezone)}</div>
                      {s.nextRunAt && <s-text color="subdued">{s.timezone || "UTC"}</s-text>}
                    </s-table-cell>
                    <s-table-cell>
                      <PolarisSwitch
                        label={s.enabled ? "Enabled" : "Paused"}
                        checked={s.enabled}
                        onChange={(checked) => toggle(s.id, checked)}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      {/* Plain flex, not s-stack: it must never wrap the Delete button onto a second line. */}
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                        <s-tooltip id={`run-${s.id}`}>Run now</s-tooltip>
                        <s-button
                          variant="primary"
                          icon="play"
                          interestFor={`run-${s.id}`}
                          accessibilityLabel="Run now"
                          loading={runningId === String(s.id) || undefined}
                          onClick={() => runNow(s.id)}
                        ></s-button>
                        <s-tooltip id={`edit-${s.id}`}>Edit</s-tooltip>
                        <s-button
                          variant={showForm && form.id === s.id ? "primary" : "secondary"}
                          icon="edit"
                          interestFor={`edit-${s.id}`}
                          accessibilityLabel="Edit"
                          onClick={() => (showForm && form.id === s.id ? closeForm() : startEdit(s))}
                        ></s-button>
                        <s-tooltip id={`del-${s.id}`}>Delete</s-tooltip>
                        <s-button
                          variant="secondary"
                          tone="critical"
                          icon="delete"
                          interestFor={`del-${s.id}`}
                          accessibilityLabel={`Delete ${s.name}`}
                          onClick={() => remove(s.id)}
                        ></s-button>
                      </div>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      )}

      {showForm && (
        <s-section heading={editing ? "Edit schedule" : "New schedule"}>
          <s-stack direction="block" gap="base">
            {actionData?.error && !errDismissed && (
              <s-banner tone="critical" dismissible onDismiss={() => setErrDismissed(true)}>
                {actionData.error}
              </s-banner>
            )}

            <PolarisTextField
              label="Schedule name"
              placeholder="e.g. Nightly product backup"
              value={form.name}
              onChange={(v) => set({ name: v })}
            />

            {/* ── What to run (SyncifyPro task selection) ── */}
            {!editing && (
              <>
                <s-text type="strong">Type</s-text>
                <s-stack direction="inline" gap="small-300">
                  <s-button
                    variant={form.type === "export" ? "primary" : "tertiary"}
                    onClick={() => set({ type: "export" })}
                  >
                    Export
                  </s-button>
                  <s-button
                    variant={form.type === "import" ? "primary" : "tertiary"}
                    onClick={() => set({ type: "import" })}
                  >
                    Import
                  </s-button>
                </s-stack>
                {form.type === "export" && presets.length > 0 && (
                  <div style={{ maxWidth: 300 }}>
                    <PolarisSelect label="Configuration" value={form.configSource} onChange={(v) => set({ configSource: v })}>
                      <s-option value="entities">Entities (all fields)</s-option>
                      <s-option value="preset">Saved preset</s-option>
                    </PolarisSelect>
                  </div>
                )}
              </>
            )}

            {form.type === "export" && (
              usingPreset ? (
                <div style={{ maxWidth: 420 }}>
                  <PolarisSelect label="Preset" value={form.presetId} onChange={(v) => set({ presetId: v })}>
                    {presets.map((p) => (
                      <s-option key={p.id} value={p.id}>
                        {p.name} ({String(p.format).toUpperCase()})
                      </s-option>
                    ))}
                  </PolarisSelect>
                  <s-text color="subdued">Runs the preset&rsquo;s entities, filters and columns. Save presets on the Export page.</s-text>
                </div>
              ) : form.hasSpec ? (
                <s-text color="subdued">
                  This schedule runs a saved preset&rsquo;s configuration (entities, filters and columns are preserved).
                </s-text>
              ) : (
                <>
                  <s-text type="strong">Entities</s-text>
                  <div style={chips}>
                    {visibleEntities.map((e) => (
                      <div key={e} style={{ ...chip, ...(form.entities.includes(e) ? chipOn : null) }}>
                        <PolarisCheckbox
                          label={titleCase(e)}
                          checked={form.entities.includes(e)}
                          onChange={() => toggleEntity(e)}
                        />
                      </div>
                    ))}
                  </div>
                  {/* Same popover Format picker as the Export page — each
                      option carries its format icon. */}
                  <div style={{ maxWidth: 220 }}>
                    <span style={pickerLabel}>Format</span>
                    <div ref={formatTriggerRef}>
                      <s-clickable
                        command="--toggle"
                        commandFor="sched-format-popover"
                        inlineSize="100%"
                        borderWidth="base"
                        borderStyle="solid"
                        borderColor="strong"
                        borderRadius="base"
                        paddingInline="small-100"
                        blockSize="32px"
                        background="base"
                      >
                        <s-grid gridTemplateColumns="auto 1fr auto" gap="small" alignItems="center">
                          <FormatIcon format={form.format} />
                          <span>{FORMATS.find((f) => f.value === form.format)?.label ?? form.format}</span>
                          <s-icon type="select" />
                        </s-grid>
                      </s-clickable>
                    </div>
                    <s-popover id="sched-format-popover" {...widthProps(Math.max(formatTriggerWidth, 220))}>
                      <s-box padding="small-200">
                        <s-stack direction="block" gap="small-300">
                          {FORMATS.map((f) => (
                            <PickerRow
                              key={f.value}
                              label={f.label}
                              icon={<FormatIcon format={f.value} />}
                              selected={form.format === f.value}
                              onSelect={() => set({ format: f.value })}
                              popoverId="sched-format-popover"
                            />
                          ))}
                        </s-stack>
                      </s-box>
                    </s-popover>
                  </div>
                  {presets.length === 0 && (
                    <s-text color="subdued">Tip: save a preset on the Export page to schedule a filtered export.</s-text>
                  )}
                </>
              )
            )}

            {form.type === "import" && (
              <s-stack direction="block" gap="small">
                {/* Prefetch the Servers page so "Add new URL…" / "+" jump instantly. */}
                <PrefetchPageLinks page="/app/servers" />
                <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
                  <PolarisSelect
                    label="Server"
                    labelAccessibilityVisibility="exclusive"
                    value={form.sourceServerId}
                    onChange={(v) => (v === "__add__" ? navigate("/app/servers") : set({ sourceServerId: v }))}
                  >
                    <s-option value="">Direct URL</s-option>
                    <s-option value="__add__">Add new URL…</s-option>
                    {servers.length > 0 && (
                      <s-option disabled value="__saved__">— Choose from saved —</s-option>
                    )}
                    {servers.map((s) => (
                      <s-option key={s.id} value={s.id}>{s.label}</s-option>
                    ))}
                  </PolarisSelect>
                  <PolarisTextField
                    label="Source file or folder"
                    labelAccessibilityVisibility="exclusive"
                    placeholder={sourceServer
                      ? (sourceServer.protocol === "https"
                        ? "file path on the server, e.g. exports/products.csv"
                        : "path or folder (blank = whole root folder)")
                      : "e.g. sftp://supplier.com/feeds/products.csv or ftp://host/feeds/"}
                    value={form.sourcePath}
                    onChange={(v) => set({ sourcePath: v })}
                  />
                  <span>
                    <s-tooltip id="sched-add-server-tip">Add a new server</s-tooltip>
                    <s-button
                      interestFor="sched-add-server-tip"
                      icon="plus"
                      accessibilityLabel="Add a new server"
                      onClick={() => navigate("/app/servers")}
                    />
                  </span>
                </s-grid>
                <s-text color="subdued">
                  Fetched fresh on every run, so the schedule always imports the current contents.
                  Point it at a FOLDER (a directory path, or blank for the server&rsquo;s root) to
                  import every CSV/Excel/ZIP file inside it. Manage servers on the Servers page.
                </s-text>
                <PolarisSwitch
                  label="Only import new files"
                  checked={form.onlyNewFiles}
                  onChange={(checked) => set({ onlyNewFiles: checked })}
                />
                <s-text color="subdued">
                  For folder sources: files this schedule has already imported are skipped on later
                  runs (a failed file is retried). Turn off to re-import everything each run.
                </s-text>
                {editing && !effectiveSourceUrl && (
                  <s-text color="subdued">
                    This schedule re-imports a stored copy of its file — pick a server or enter a
                    URL above to switch it to fetching fresh data each run.
                  </s-text>
                )}
                <div style={{ maxWidth: 420 }}>
                  <PolarisSelect label="Import setup" value={form.importPresetId} onChange={(v) => set({ importPresetId: v })}>
                    <s-option value="">Auto-detect from the file</s-option>
                    {importPresets.map((p) => (
                      <s-option key={p.id} value={p.id}>Preset: {p.name}</s-option>
                    ))}
                  </PolarisSelect>
                </div>
                <s-text color="subdued">
                  The setup is the per-sheet plan (entity, filters, columns) and import mode. Save presets on the Import page.
                </s-text>
              </s-stack>
            )}

            {/* ── Schedule type ── */}
            <s-text type="strong">Schedule type</s-text>
            {/* Two-column cadence grid: Frequency+Hour, then Minute+Timezone
                (conditional day fields flow into the same grid). */}
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <PolarisSelect label="Frequency" value={form.frequency} onChange={(v) => set({ frequency: v })}>
                {FREQUENCIES.map((f) => (
                  <s-option key={f.value} value={f.value}>{f.label}</s-option>
                ))}
              </PolarisSelect>

              {form.frequency === "weekly" && (
                <PolarisSelect label="Day of week" value={form.weekday} onChange={(v) => set({ weekday: v })}>
                  {WEEKDAYS.map((d, i) => (
                    <s-option key={i} value={String(i)}>{d}</s-option>
                  ))}
                </PolarisSelect>
              )}

              {(form.frequency === "monthly" || form.frequency === "quarterly") && (
                <PolarisNumberField
                  label="Day of month"
                  value={form.monthday}
                  min={1}
                  max={28}
                  onChange={(v) => set({ monthday: v })}
                />
              )}

              {!["hourly", "every15min", "every30min"].includes(form.frequency) && (
                <PolarisNumberField
                  label="Hour (0–23)"
                  value={form.hour}
                  min={0}
                  max={23}
                  onChange={(v) => set({ hour: v })}
                />
              )}
              {/* Sub-hourly cadences run on a fixed :00/:15/:30/:45 grid. */}
              {!["every15min", "every30min"].includes(form.frequency) && (
                <PolarisNumberField
                  label="Minute"
                  value={form.minute}
                  min={0}
                  max={59}
                  onChange={(v) => set({ minute: v })}
                />
              )}
              {/* Hour/Minute above are read in this zone; defaults to the store's. */}
              <PolarisSelect
                label="Timezone"
                value={form.timezone}
                onChange={(v) => set({ timezone: v })}
              >
                {timezoneChoices(form.timezone).map((z) => (
                  <s-option key={z} value={z}>{timezoneLabel(z)}</s-option>
                ))}
              </PolarisSelect>
            </s-grid>

            {/* ── Delivery destinations (exports only — imports READ data, they
                 don't produce a file to send anywhere) ── */}
            {form.type === "export" && (<>
            {/* A saved preset carries its own File name template — the
                schedule takes it from there. */}
            {!usingPreset && (
              <>
                <div style={{ maxWidth: 420 }}>
                  <PolarisTextField
                    label="Delivery file name (optional)"
                    placeholder="e.g. products-{date} or catalog (fixed = overwritten by each run)"
                    value={form.filenameTemplate}
                    onChange={(v) => set({ filenameTemplate: v })}
                  />
                </div>
                <s-text color="subdued">
                  Placeholders: {"{date}"}, {"{time}"}, {"{shop}"}, {"{name}"}. The format extension is
                  added automatically. Leave blank for &ldquo;name-date&rdquo;.
                </s-text>
              </>
            )}
            {/* A saved preset already carries the split setting — asking again
                here would either duplicate or contradict it. */}
            {!usingPreset && (
              <>
                <div style={{ maxWidth: 420 }}>
                  <PolarisTextField
                    label="Split into files of N records (optional)"
                    placeholder="e.g. 5000 — leave blank for one file"
                    value={form.splitRows}
                    onChange={(v) => set({ splitRows: v })}
                  />
                </div>
                <s-text color="subdued">
                  Splitting delivers a zip of numbered parts; a record that spans several rows
                  (products, orders) is never cut in half.
                </s-text>
              </>
            )}
            <s-text type="strong">Delivery destinations</s-text>
            <s-text color="subdued">
              Enable one or more. Every enabled destination receives the file on each run.
            </s-text>
            <s-stack direction="inline" gap="small-300">
              {DESTINATIONS.map((d) => (
                <s-button
                  key={d.key}
                  variant={deliveryTab === d.key ? "primary" : "tertiary"}
                  onClick={() => setDeliveryTab(d.key)}
                >
                  {destEnabled[d.key] ? `${d.label} ✓` : d.label}
                </s-button>
              ))}
            </s-stack>

            {deliveryTab === "email" && (
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack direction="block" gap="base">
                  {/* No email provider on the server → say so up front rather
                      than let a schedule "send" nothing. */}
                  {!emailConfigured && (
                    <s-banner tone="warning">
                      Email delivery isn’t available on this installation yet — files can still be delivered by FTP, S3 or Google, and downloaded from Activity.
                    </s-banner>
                  )}
                  <PolarisSwitch
                    label="Send via email"
                    checked={emailConfigured && form.emailOn}
                    disabled={!emailConfigured}
                    onChange={(checked) => set({ emailOn: checked })}
                  />
                  <PolarisTextField
                    label="Email recipients"
                    placeholder="comma-separated, e.g. owner@store.com, ops@store.com"
                    value={form.recipients}
                    disabled={!emailConfigured}
                    onChange={(v) => set({ recipients: v })}
                  />
                </s-stack>
              </s-box>
            )}

            {deliveryTab === "ftp" && (
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack direction="block" gap="base">
                  <PolarisSwitch
                    label="Upload via FTP / SFTP / FTPS"
                    checked={form.ftpOn}
                    onChange={(checked) => set({ ftpOn: checked })}
                  />
                  {/* A saved server from the Servers page carries the
                      protocol/host/credentials; manual entry stays available. */}
                  {/* Popover picker (matches the run page's Deliver-to): each
                      option carries an icon; saved servers list under a header. */}
                  <div style={{ maxWidth: 420 }}>
                    <span style={pickerLabel}>Server</span>
                    <div ref={ftpTriggerRef}>
                      <s-clickable
                        command="--toggle"
                        commandFor="ftp-server-popover"
                        inlineSize="100%"
                        borderWidth="base"
                        borderStyle="solid"
                        borderColor="strong"
                        borderRadius="base"
                        paddingInline="small-100"
                        blockSize="32px"
                        background="base"
                      >
                        {(() => {
                          const sel = ftpServers.find((s) => s.id === form.ftpServerId);
                          return (
                            <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="center">
                              <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
                                <s-icon type={sel ? "database" : "edit"} />
                                {sel ? `${sel.label} (${String(sel.protocol).toUpperCase()})` : "Enter details manually"}
                              </span>
                              <s-icon type="select" />
                            </s-grid>
                          );
                        })()}
                      </s-clickable>
                    </div>
                    <s-popover id="ftp-server-popover" {...widthProps(Math.max(ftpTriggerWidth, 240))}>
                      <s-box padding="small-200">
                        <s-stack direction="block" gap="small-300">
                          <PickerRow
                            icon={<s-icon type="edit" />}
                            label="Enter details manually"
                            selected={!form.ftpServerId}
                            onSelect={() => set({ ftpServerId: "" })}
                            popoverId="ftp-server-popover"
                          />
                          {/* Navigates — adding a server lives on its own page. */}
                          <s-clickable
                            onClick={() => { setAddingServer(true); navigate("/app/servers"); }}
                            padding="small-200"
                            borderRadius="base"
                          >
                            <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
                              <span style={checkSlot}>
                                {addingServer
                                  ? <s-spinner size="small" accessibilityLabel="Opening Servers" />
                                  : <s-icon type="plus" />}
                              </span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
                                Add a new server
                                {/* External glyph: this row navigates to the Servers page. */}
                                <s-icon type="external" />
                              </span>
                            </s-grid>
                          </s-clickable>
                          <s-text color="subdued">Saved servers</s-text>
                          {ftpServers.length === 0 && (
                            <s-text color="subdued">No saved servers yet.</s-text>
                          )}
                          {ftpServers.map((s) => (
                            <PickerRow
                              key={s.id}
                              icon={<s-icon type="database" />}
                              label={`${s.label} (${String(s.protocol).toUpperCase()})`}
                              selected={form.ftpServerId === s.id}
                              onSelect={() => set({ ftpServerId: s.id })}
                              popoverId="ftp-server-popover"
                            />
                          ))}
                        </s-stack>
                      </s-box>
                    </s-popover>
                  </div>
                  {form.ftpServerId ? (
                    <s-text color="subdued">
                      Host and credentials come from the saved server — manage them on the Servers page.
                    </s-text>
                  ) : (
                    <>
                      <PolarisSelect
                        label="Protocol"
                        value={form.ftpProtocol}
                        onChange={(proto) => {
                          const defPort = proto === "sftp" ? "22" : "21";
                          // Auto-set the port to the protocol default unless the user typed a custom one.
                          setForm((f) => ({
                            ...f,
                            ftpProtocol: proto,
                            ftpPort: !f.ftpPort || f.ftpPort === "21" || f.ftpPort === "22" ? defPort : f.ftpPort,
                          }));
                        }}
                      >
                        <s-option value="ftp">FTP</s-option>
                        <s-option value="sftp">SFTP</s-option>
                        <s-option value="ftps">FTPS</s-option>
                      </PolarisSelect>
                      <s-stack direction="inline" gap="base">
                        <PolarisTextField
                          label="FTP host"
                          value={form.ftpHost}
                          onChange={(v) => set({ ftpHost: v })}
                        />
                        <PolarisNumberField
                          label="Port"
                          value={form.ftpPort}
                          min={1}
                          max={65535}
                          onChange={(v) => set({ ftpPort: v })}
                        />
                      </s-stack>
                      <s-stack direction="inline" gap="base">
                        <PolarisTextField
                          label="Username"
                          value={form.ftpUser}
                          onChange={(v) => set({ ftpUser: v })}
                        />
                        <PolarisPasswordField
                          label="Password"
                          value={form.ftpPassword}
                          onChange={(v) => set({ ftpPassword: v })}
                        />
                      </s-stack>
                    </>
                  )}
                  <PolarisTextField
                    label="Remote directory"
                    placeholder="/exports"
                    value={form.ftpPath}
                    onChange={(v) => set({ ftpPath: v })}
                  />
                </s-stack>
              </s-box>
            )}

            {deliveryTab === "gdrive" && (
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack direction="block" gap="base">
                  <PolarisSwitch
                    label="Upload to Google Drive"
                    checked={form.driveOn}
                    onChange={(checked) => set({ driveOn: checked })}
                  />
                  <PolarisTextField
                    label="Google Drive folder (ID, optional)"
                    placeholder="leave blank for My Drive root"
                    value={form.gdrive}
                    onChange={(v) => set({ gdrive: v })}
                  />
                  {googleConnect}
                </s-stack>
              </s-box>
            )}

            {deliveryTab === "gsheets" && (
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack direction="block" gap="base">
                  <PolarisSwitch
                    label="Export to Google Sheets"
                    checked={form.sheetsOn}
                    onChange={(checked) => set({ sheetsOn: checked })}
                  />
                  <PolarisTextField
                    label="Sheet name (optional)"
                    placeholder="defaults to the schedule name"
                    value={form.gsheet}
                    onChange={(v) => set({ gsheet: v })}
                  />
                  <PolarisTextField
                    label="Drive folder (ID, optional)"
                    value={form.gsheetFolder}
                    onChange={(v) => set({ gsheetFolder: v })}
                  />
                  <s-text color="subdued">Sheets delivery needs a CSV schedule (the file is converted to a native Sheet).</s-text>
                  {googleConnect}
                </s-stack>
              </s-box>
            )}

            {deliveryTab === "s3" && (
              <s-box border="base" borderRadius="base" padding="base">
                <s-stack direction="block" gap="base">
                  <PolarisSwitch
                    label="Upload to Amazon S3"
                    checked={form.s3On}
                    onChange={(checked) => set({ s3On: checked })}
                  />
                  {/* A saved S3 server from the Servers page carries the
                      bucket/region/keys; manual entry stays available. */}
                  <PolarisSelect
                    label="Server"
                    value={form.s3ServerId || "manual"}
                    onChange={(v) => {
                      if (v === "__add__") navigate("/app/servers");
                      else set({ s3ServerId: s3Servers.some((s) => s.id === v) ? v : "" });
                    }}
                  >
                    <s-option value="manual">Enter details manually</s-option>
                    <s-option value="__add__">Add new server…</s-option>
                    {s3Servers.length > 0 && (
                      <s-option disabled value="__saved__">— Saved servers —</s-option>
                    )}
                    {s3Servers.map((s) => (
                      <s-option key={s.id} value={s.id}>{s.label} (S3)</s-option>
                    ))}
                  </PolarisSelect>
                  {form.s3ServerId ? (
                    <s-text color="subdued">
                      Bucket and keys come from the saved server — manage them on the Servers page.
                    </s-text>
                  ) : (
                    <>
                      <s-stack direction="inline" gap="base">
                        <PolarisTextField
                          label="Bucket"
                          value={form.s3Bucket}
                          onChange={(v) => set({ s3Bucket: v })}
                        />
                        <PolarisTextField
                          label="Region"
                          placeholder="us-east-1"
                          value={form.s3Region}
                          onChange={(v) => set({ s3Region: v })}
                        />
                      </s-stack>
                      <s-stack direction="inline" gap="base">
                        <PolarisTextField
                          label="Access key ID"
                          value={form.s3AccessKeyId}
                          onChange={(v) => set({ s3AccessKeyId: v })}
                        />
                        <PolarisPasswordField
                          label="Secret access key"
                          value={form.s3SecretAccessKey}
                          onChange={(v) => set({ s3SecretAccessKey: v })}
                        />
                      </s-stack>
                    </>
                  )}
                  <PolarisTextField
                    label="Folder / prefix (optional)"
                    placeholder="exports/"
                    value={form.s3Prefix}
                    onChange={(v) => set({ s3Prefix: v })}
                  />
                  {!form.s3ServerId && (
                    <PolarisTextField
                      label="Custom endpoint (optional, for S3-compatible storage)"
                      placeholder="https://… (leave blank for AWS)"
                      value={form.s3Endpoint}
                      onChange={(v) => set({ s3Endpoint: v })}
                    />
                  )}
                </s-stack>
              </s-box>
            )}

            {googleNeeded && !google.connected && deliveryTab !== "gdrive" && deliveryTab !== "gsheets" && (
              <s-banner tone="warning">
                A Google destination is enabled but not connected — open the Google Drive/Sheets tab to connect.
              </s-banner>
            )}
            </>)}

            <PolarisSwitch
              label={form.enabled ? "Enabled" : "Paused"}
              checked={form.enabled}
              onChange={(checked) => set({ enabled: checked })}
            />

            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                loading={saving || undefined}
                disabled={!canSave || saving ? true : undefined}
                onClick={save}
              >
                {editing ? "Save changes" : "Create schedule"}
              </s-button>
              <s-button variant="tertiary" onClick={closeForm}>
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {tab === "history" && (
        <s-section heading="Schedule history">
          {history.length === 0 ? (
            <s-paragraph>No runs yet. Use “Run now” or wait for a scheduled run.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small-300">
              {histPages > 1 && (
                <s-text color="subdued">Page {historyPage} of {histPages}</s-text>
              )}
              <s-table
                variant="auto"
                {...(histPages > 1
                  ? {
                      paginate: true,
                      hasPreviousPage: historyPage > 1,
                      hasNextPage: historyPage < histPages,
                      onPreviousPage: () => setHistoryPage((p) => Math.max(1, p - 1)),
                      onNextPage: () => setHistoryPage((p) => Math.min(histPages, p + 1)),
                    }
                  : {})}
              >
                <s-table-header-row>
                  <s-table-header>Run at</s-table-header>
                  <s-table-header>Schedule</s-table-header>
                  <s-table-header>Task</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Records</s-table-header>
                  <s-table-header>Delivery</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {histSlice.map((h) => (
                    <s-table-row key={h.id}>
                      <s-table-cell>{fmtDateTime(h.runAt)}</s-table-cell>
                      <s-table-cell>{h.scheduleName}</s-table-cell>
                      <s-table-cell>{h.task}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={h.status === "ok" ? "success" : "critical"}>
                          {h.status === "ok" ? "Success" : "Failed"}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>{h.rows}</s-table-cell>
                      <s-table-cell>{h.delivery || h.message || "—"}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-stack>
          )}
        </s-section>
      )}
    </s-page>
  );
}

// ─── web-component bridges (same pattern as PolarisSelect/PolarisTextField) ────

/* eslint-disable react/prop-types */
function PolarisSwitch({ label, checked, onChange }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(Boolean(e.target.checked));
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && Boolean(el.checked) !== Boolean(checked)) el.checked = Boolean(checked);
  }, [checked]);
  return <s-switch ref={ref} label={label} checked={checked ? true : undefined} />;
}

function PolarisNumberField({ label, value, min, max, onChange }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(String(e.target.value));
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && String(el.value ?? "") !== String(value ?? "")) el.value = value ?? "";
  }, [value]);
  return <s-number-field ref={ref} label={label} min={min} max={max} step={1} inputMode="numeric" />;
}

function PolarisPasswordField({ label, value, onChange }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(e.target.value);
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== (value ?? "")) el.value = value ?? "";
  }, [value]);
  return <s-password-field ref={ref} label={label} />;
}
/* eslint-enable react/prop-types */

// ─── styles ──────────────────────────────────────────────────────────────────

const chips = { display: "flex", flexWrap: "wrap", gap: ".4rem" };
const chip = { display: "inline-flex", alignItems: "center", gap: ".35rem", padding: ".25rem .6rem", borderRadius: 999, border: "1px solid #c9cccf", background: "#fff", fontSize: ".85rem", cursor: "pointer" };
const chipOn = { background: "#f1f6fe", borderColor: "#2c6ecb" };
