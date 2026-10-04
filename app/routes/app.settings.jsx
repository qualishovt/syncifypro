/**
 * app/routes/app.settings.jsx
 *
 * App settings, Matrixify-style: a left menu of sections, each opening its own
 * card on the right. Menu items are grouped by spacing only (no group headings).
 *
 *   • Defaults       — default export format + import mode (pre-selected on those pages)
 *   • Notifications  — email + notify-on-success / notify-on-error for finished jobs
 *   • Time zone      — the zone job/schedule timestamps are displayed in
 *   • File retention — how long download files are kept, + delete-expired-now
 *
 * Everything persists to AppSettings (one row per shop).
 */

import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server.js";
import PolarisSelect from "../components/PolarisSelect.jsx";
import PolarisCheckbox from "../components/PolarisCheckbox.jsx";
import { timezoneChoices, timezoneLabel } from "../utils/timezones.js";

// ─── options ─────────────────────────────────────────────────────────────────

const RETENTION_CHOICES = [1, 3, 7, 14, 30, 60, 90, 0];
const retentionLabel = (d) => (d === 0 ? "Never — keep forever" : `${d} day${d === 1 ? "" : "s"}`);

const FORMAT_CHOICES = [
  { value: "csv", label: "CSV" }, { value: "excel", label: "Excel" },
  { value: "xml", label: "XML" }, { value: "json", label: "JSON" },
  { value: "pdf", label: "PDF" },
];
const IMPORT_MODE_CHOICES = [
  { value: "normal", label: "Normal — follow the Command column" },
  { value: "updateOnly", label: "Update only — skip new records" },
  { value: "createOnly", label: "Create only — skip existing records" },
  { value: "noDelete", label: "Add new and update existing — ignore delete rows" },
  { value: "forceCreate", label: "Create even if exists (may cause duplicates)" },
  { value: "dryRun", label: "Dry run — validate, write nothing" },
];
// A curated set of common IANA zones (JS Intl handles the offset/DST math).
// Left menu grouped into categories (distinct from Matrixify's flat list), with
// our own section names. Each item shows its current value as a subtitle.
const MENU_GROUPS = [
  { title: "General", items: [
    { key: "defaults",      label: "Defaults",       icon: "settings" },
    { key: "timezone",      label: "Time zone",      icon: "clock" },
    { key: "notifications", label: "Notifications",  icon: "notification" },
  ] },
  { title: "Files & data", items: [
    { key: "permissions",   label: "Data access",    icon: "filter" },
    { key: "retention",     label: "File retention", icon: "calendar" },
    { key: "erasure",       label: "Clear files",    icon: "delete" },
  ] },
  { title: "Security & access", items: [
    { key: "security",      label: "Security",            icon: "lock" },
    { key: "scopes",        label: "Permissions granted", icon: "key" },
  ] },
  { title: "App", items: [
    { key: "plan",          label: "Plan",           icon: "star" },
    { key: "about",         label: "About",          icon: "info" },
  ] },
];

const IMPORT_MODE_LABELS = {
  normal: "Normal", updateOnly: "Update only", createOnly: "Create only",
  noDelete: "Add and update", forceCreate: "Create even if exists", dryRun: "Dry run",
};

// The one-line current-value shown under each menu item.
function summaryFor(key, settings, scopes, plan) {
  switch (key) {
    case "defaults":      return `${FORMAT_CHOICES.find((f) => f.value === settings.defaultExportFormat)?.label ?? settings.defaultExportFormat} · ${IMPORT_MODE_LABELS[settings.defaultImportMode] ?? "Normal"}`;
    case "timezone":      return settings.timezone;
    case "notifications": return settings.notifyOnSuccess || settings.notifyOnError ? "On" : "Off";
    case "permissions": {
      const blocked = settings.blockedEntities?.length ?? 0;
      return blocked === 0 ? "All allowed" : `${PERMISSION_ENTITIES.length - blocked}/${PERMISSION_ENTITIES.length} allowed`;
    }
    case "retention":     return settings.retentionDays === 0 ? "Never" : `${settings.retentionDays} day${settings.retentionDays === 1 ? "" : "s"}`;
    case "erasure":       return "Manual";
    case "security":      return settings.allowExternalDownloads ? "External allowed" : "In-app only";
    case "scopes":        return `${scopes.length} scope${scopes.length === 1 ? "" : "s"}`;
    case "plan":          return plan?.planName ?? "Basic";
    default:              return "";
  }
}

// Entities that can be allowed/blocked in Sheet Permissions. Keys match the
// export ENTITIES list and the import entity keys, so blocking gates both.
const PERMISSION_ENTITIES = [
  { key: "products",     label: "Products" },
  { key: "orders",       label: "Orders" },
  { key: "customers",    label: "Customers" },
  { key: "collections",  label: "Collections" },
  { key: "discounts",    label: "Discounts" },
  { key: "draft_orders", label: "Draft orders" },
  { key: "gift_cards",   label: "Gift cards" },
  { key: "inventory",    label: "Inventory" },
  { key: "selling_plans", label: "Selling plans" },
  { key: "metafields",   label: "Metafields" },
  { key: "segments",     label: "Customer segments" },
  { key: "store_credit", label: "Store credit" },
  { key: "markets",      label: "Markets" },
  { key: "delivery_profiles", label: "Shipping profiles" },
  { key: "product_media", label: "Product media" },
  { key: "content",      label: "Content (pages, blogs, articles)" },
  { key: "redirects",    label: "Redirects" },
  { key: "companies",    label: "Companies" },
  { key: "metaobjects",  label: "Metaobjects" },
  { key: "files",        label: "Files" },
  { key: "translations", label: "Translatables" },
];

// ─── loader / action ─────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const { getAppSettings } = await import("../db/appSettings.server.js");
  const settings = await getAppSettings(session.shop);

  // API Access Scopes: the Shopify permissions this app was granted (read-only).
  let scopes = [];
  try {
    const resp = await admin.graphql(`#graphql
      query AppScopes { currentAppInstallation { accessScopes { handle } } }`);
    const { data } = await resp.json();
    scopes = (data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle).sort();
  } catch { /* leave empty on error */ }

  // App name/version for the About card (read from package.json, server-only).
  let appInfo = { name: "SyncifyPro", version: "" };
  try {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    appInfo = { name: "SyncifyPro", version: pkg.version || "" };
  } catch { /* keep default */ }

  // Current plan (Managed Pricing) + the plan-selection page for this shop.
  const { getPlan, planPageUrl, EVERYTHING_FREE } = await import("../billing.server.js");
  const planInfo = await getPlan(admin);
  const plan = { ...planInfo, url: planPageUrl(session.shop), everythingFree: EVERYTHING_FREE };

  return { settings, scopes, appInfo, plan };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  // Run the retention cleanup on demand (honours the *saved* window).
  if (intent === "cleanup") {
    const { runFileCleanup } = await import("../db/cleanup.server.js");
    return { cleaned: await runFileCleanup() };
  }

  // Erase ALL of this shop's downloadable job files now (Job Files Erasure).
  if (intent === "eraseAll") {
    const { eraseAllShopFiles } = await import("../db/cleanup.server.js");
    return { erased: await eraseAllShopFiles(shop) };
  }

  const { updateAppSettings } = await import("../db/appSettings.server.js");

  const patchByIntent = {
    saveDefaults: {
      defaultExportFormat: String(fd.get("defaultExportFormat") || "excel"),
      defaultImportMode: String(fd.get("defaultImportMode") || "normal"),
    },
    saveNotifications: {
      notifyEmail: String(fd.get("notifyEmail") || ""),
      notifyOnSuccess: fd.get("notifyOnSuccess") === "true",
      notifyOnError: fd.get("notifyOnError") === "true",
    },
    saveTimezone: { timezone: String(fd.get("timezone") || "UTC") },
    saveRetention: { retentionDays: String(fd.get("retentionDays") ?? "7") },
    saveSecurity: { allowExternalDownloads: fd.get("allowExternalDownloads") === "true" },
    saveSheetPermissions: { blockedEntities: String(fd.get("blockedEntities") || "[]") },
  };

  const patch = patchByIntent[intent];
  if (!patch) return { error: "Unknown settings section." };
  const settings = await updateAppSettings(shop, patch);
  return { saved: intent, settings };
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, scopes, appInfo, plan } = useLoaderData();
  const [active, setActive] = useState("defaults");

  return (
    <s-page heading="Settings">
      <div style={layout}>
        {/* Left menu — grouped, icon + label + current value, accent on active */}
        <nav style={menuCol}>
          {MENU_GROUPS.map((group) => (
            <div key={group.title} style={menuGroup}>
              {group.items.map((m) => {
                const on = active === m.key;
                const value = summaryFor(m.key, settings, scopes, plan);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setActive(m.key)}
                    style={{ ...menuItem, ...(on ? menuItemActive : null) }}
                  >
                    <span style={{ ...menuIcon, ...(on ? menuIconActive : null) }}><s-icon type={m.icon} /></span>
                    <span style={menuText}>
                      <span style={{ ...menuLabel, ...(on ? menuLabelActive : null) }}>{m.label}</span>
                      {value && <span style={menuValue}>{value}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Active section card */}
        <div style={cardCol}>
          {active === "security"      && <SecurityCard settings={settings} />}
          {active === "notifications" && <NotificationsCard settings={settings} />}
          {active === "defaults"      && <DefaultsCard settings={settings} />}
          {active === "timezone"      && <TimezoneCard settings={settings} />}
          {active === "permissions"   && <SheetPermissionsCard settings={settings} />}
          {active === "retention"     && <RetentionCard settings={settings} />}
          {active === "erasure"       && <ErasureCard />}
          {active === "scopes"        && <ScopesCard scopes={scopes} />}
          {active === "plan"          && <PlanCard plan={plan} />}
          {active === "about"         && <AboutCard appInfo={appInfo} />}
        </div>
      </div>
    </s-page>
  );
}

// ─── section cards ───────────────────────────────────────────────────────────

/* eslint-disable react/prop-types */
function Card({ heading, description, children }) {
  return (
    <s-section heading={heading}>
      <s-stack direction="block" gap="base">
        {description && <s-text color="subdued">{description}</s-text>}
        {children}
      </s-stack>
    </s-section>
  );
}

function SaveRow({ onSave, saving, saved, disabled }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-button variant="primary" onClick={onSave} disabled={saving || disabled} loading={saving ? true : undefined}>
        Save
      </s-button>
      {saved && <s-text color="subdued">Saved.</s-text>}
    </s-stack>
  );
}

function SecurityCard({ settings }) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const [allow, setAllow] = useState(settings.allowExternalDownloads);
  const dirty = allow !== settings.allowExternalDownloads;

  // Toggling saves immediately (single-control card, like Matrixify's).
  const onToggle = (v) => {
    setAllow(v);
    fetcher.submit({ intent: "saveSecurity", allowExternalDownloads: String(v) }, { method: "post" });
  };

  return (
    <Card heading="Security" description="Configure your security settings.">
      <div style={toggleBox}>
        <PolarisCheckbox
          label="Allow downloading your files by external services"
          checked={allow}
          onChange={onToggle}
          disabled={saving}
        />
      </div>
      <s-text color="subdued">
        When on, a job’s signed download link can be fetched by external services (integrations, automation).
        When off, files are only downloadable from inside the app.
      </s-text>
      {fetcher.data?.saved === "saveSecurity" && !saving && !dirty && <s-text color="subdued">Saved.</s-text>}
    </Card>
  );
}

function DefaultsCard({ settings }) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const [format, setFormat] = useState(settings.defaultExportFormat);
  const [mode, setMode] = useState(settings.defaultImportMode);
  const dirty = format !== settings.defaultExportFormat || mode !== settings.defaultImportMode;

  const save = () => fetcher.submit(
    { intent: "saveDefaults", defaultExportFormat: format, defaultImportMode: mode },
    { method: "post" },
  );

  return (
    <Card heading="Defaults" description="Pre-select the export format and import mode used when you open a new export or import. You can still change them per job.">
      <div style={{ maxWidth: 340 }}>
        <PolarisSelect label="Default export format" value={format} onChange={setFormat} disabled={saving}>
          {FORMAT_CHOICES.map((f) => <s-option key={f.value} value={f.value}>{f.label}</s-option>)}
        </PolarisSelect>
      </div>
      <div style={{ maxWidth: 420 }}>
        <PolarisSelect label="Default import mode" value={mode} onChange={setMode} disabled={saving}>
          {IMPORT_MODE_CHOICES.map((m) => <s-option key={m.value} value={m.value}>{m.label}</s-option>)}
        </PolarisSelect>
      </div>
      <SaveRow onSave={save} saving={saving} saved={fetcher.data?.saved === "saveDefaults" && !saving} disabled={!dirty} />
    </Card>
  );
}

function NotificationsCard({ settings }) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const [email, setEmail] = useState(settings.notifyEmail);
  const [onSuccess, setOnSuccess] = useState(settings.notifyOnSuccess);
  const [onError, setOnError] = useState(settings.notifyOnError);
  const dirty = email !== settings.notifyEmail || onSuccess !== settings.notifyOnSuccess || onError !== settings.notifyOnError;

  const save = () => fetcher.submit(
    { intent: "saveNotifications", notifyEmail: email, notifyOnSuccess: String(onSuccess), notifyOnError: String(onError) },
    { method: "post" },
  );

  return (
    <Card heading="Notifications" description="Get emailed when a background export or import finishes.">
      <label style={field}>
        <s-text type="strong">Notification email</s-text>
        <input style={input} type="email" value={email} disabled={saving}
          onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      <PolarisCheckbox label="Notify me when a job completes successfully" checked={onSuccess} onChange={setOnSuccess} disabled={saving} />
      <PolarisCheckbox label="Notify me when a job fails or has errors" checked={onError} onChange={setOnError} disabled={saving} />
      <s-banner tone="info">
        Preferences are saved now; email delivery is turned on once the app’s email sending is configured.
      </s-banner>
      <SaveRow onSave={save} saving={saving} saved={fetcher.data?.saved === "saveNotifications" && !saving} disabled={!dirty} />
    </Card>
  );
}

function TimezoneCard({ settings }) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const [tz, setTz] = useState(settings.timezone);
  const dirty = tz !== settings.timezone;

  const save = () => fetcher.submit({ intent: "saveTimezone", timezone: tz }, { method: "post" });

  return (
    <Card heading="Time zone" description="Job times across the app are displayed in this zone. Each schedule has its own timezone (defaulting to your store's), and its run time is read in that zone.">
      <div style={{ maxWidth: 340 }}>
        <PolarisSelect label="Display time zone" value={tz} onChange={setTz} disabled={saving}>
          {timezoneChoices(tz).map((z) => <s-option key={z} value={z}>{timezoneLabel(z)}</s-option>)}
        </PolarisSelect>
      </div>
      <SaveRow onSave={save} saving={saving} saved={fetcher.data?.saved === "saveTimezone" && !saving} disabled={!dirty} />
    </Card>
  );
}

function RetentionCard({ settings }) {
  const fetcher = useFetcher();        // save the retention window
  const cleanupFetcher = useFetcher(); // run the cleanup on demand
  const saving = fetcher.state !== "idle";
  const cleaning = cleanupFetcher.state !== "idle";
  const cleaned = !cleaning ? cleanupFetcher.data?.cleaned : null;
  const [days, setDays] = useState(String(settings.retentionDays));
  const dirty = days !== String(settings.retentionDays);

  const save = () => fetcher.submit({ intent: "saveRetention", retentionDays: days }, { method: "post" });
  const cleanupNow = () => cleanupFetcher.submit({ intent: "cleanup" }, { method: "post" });

  return (
    <Card heading="File retention" description="How long a job’s downloadable files (your exports, uploaded import files, and import-results workbooks) are kept before they’re deleted automatically. The job history, numbers, and outcome counts are always kept — only the download files are removed.">
      <div style={{ maxWidth: 320 }}>
        <PolarisSelect label="Delete files after" value={days} onChange={setDays} disabled={saving}>
          {RETENTION_CHOICES.map((d) => <s-option key={d} value={String(d)}>{retentionLabel(d)}</s-option>)}
        </PolarisSelect>
      </div>
      <SaveRow onSave={save} saving={saving} saved={fetcher.data?.saved === "saveRetention" && !saving} disabled={!dirty} />

      <s-text color="subdued">
        Cleanup runs daily. Files older than the window are removed on the next run; their download links then show “—” in Recent activity.
      </s-text>

      <s-divider />

      <s-stack direction="inline" gap="small" alignItems="center">
        <s-button tone="critical" onClick={cleanupNow} disabled={cleaning} loading={cleaning ? true : undefined}>
          Delete expired files now
        </s-button>
        {cleaned != null && (
          <s-text color="subdued">
            {cleaned === 0 ? "No expired files to delete." : `Removed files for ${cleaned} job${cleaned === 1 ? "" : "s"}.`}
          </s-text>
        )}
      </s-stack>
    </Card>
  );
}

function SheetPermissionsCard({ settings }) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const [blocked, setBlocked] = useState(() => new Set(settings.blockedEntities ?? []));

  const initial = new Set(settings.blockedEntities ?? []);
  const dirty = blocked.size !== initial.size || [...blocked].some((k) => !initial.has(k));

  const toggle = (key, allowed) => {
    setBlocked((prev) => {
      const next = new Set(prev);
      if (allowed) next.delete(key); else next.add(key);
      return next;
    });
  };
  const save = () => fetcher.submit(
    { intent: "saveSheetPermissions", blockedEntities: JSON.stringify([...blocked]) },
    { method: "post" },
  );

  return (
    <Card heading="Data access" description="Choose which record types can be exported and imported. Unchecked types are hidden on the Export page and rejected on Import.">
      <div style={permGrid}>
        {PERMISSION_ENTITIES.map((e) => (
          <div key={e.key} style={permItem}>
            <PolarisCheckbox
              label={e.label}
              checked={!blocked.has(e.key)}
              onChange={(allowed) => toggle(e.key, allowed)}
              disabled={saving}
            />
          </div>
        ))}
      </div>
      <SaveRow onSave={save} saving={saving} saved={fetcher.data?.saved === "saveSheetPermissions" && !saving} disabled={!dirty} />
    </Card>
  );
}

function ErasureCard() {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const erased = !busy ? fetcher.data?.erased : null;
  const eraseAll = () => fetcher.submit({ intent: "eraseAll" }, { method: "post" });

  return (
    <Card heading="Clear files" description="Erase ALL downloadable files (exports, uploaded imports, and results) from storage right now — regardless of the retention window. Job history, numbers, and outcome counts are kept; only the files are removed.">
      <s-banner tone="warning">This can’t be undone. Files already downloaded are unaffected; links in Recent activity will show “—”.</s-banner>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-button tone="critical" onClick={eraseAll} disabled={busy} loading={busy ? true : undefined}>
          Erase all files now
        </s-button>
        {erased != null && (
          <s-text color="subdued">
            {erased === 0 ? "No files to erase." : `Erased files for ${erased} job${erased === 1 ? "" : "s"}.`}
          </s-text>
        )}
      </s-stack>
    </Card>
  );
}

function ScopesCard({ scopes }) {
  return (
    <Card heading="Permissions granted" description="The Shopify permissions this app was granted. Managed by Shopify when the app is installed or updated — read-only here.">
      {scopes.length === 0 ? (
        <s-text color="subdued">Couldn’t load access scopes right now.</s-text>
      ) : (
        <div style={scopeWrap}>
          {scopes.map((s) => <span key={s} style={scopeChip}>{s}</span>)}
        </div>
      )}
    </Card>
  );
}

// Plan cards — the same layout as ReportifyPro's Plan section. Plans live in
// Shopify App Pricing (Managed Pricing), so every "Choose" button opens
// Shopify's plan-selection page; the app only reads the active subscription.
const PLAN_TIERS = [
  { name: "Basic", price: "Free", cadence: "", features: ["1,000 rows per export/import job", "All entities and formats", "Saved presets"] },
  { name: "Pro", price: "$12", cadence: "/month", popular: true, features: ["10,000 rows per job", "Scheduled exports & imports", "Email / FTP / Drive / S3 delivery", "Migrations from other platforms"] },
  { name: "Max", price: "$40", cadence: "/month", features: ["100,000 rows per job", "Everything in Pro"] },
  { name: "Enterprise", price: "$150", cadence: "/month", features: ["Unlimited rows", "Everything in Max", "Priority support"] },
];

function PlanCard({ plan }) {
  const currentName = plan?.planName ?? "Basic";
  const openPlans = () => window.open(plan.url, "_top");

  // While the app is free there is nothing to choose and nothing to pay, so
  // the tier table would only invite a merchant to buy what they already have.
  if (plan?.everythingFree) {
    return (
      <Card heading="Plan" description="Everything in SyncifyPro is free to use.">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-heading>Free</s-heading>
            <s-badge tone="success">Current</s-badge>
          </s-stack>
          <s-stack direction="block" gap="small-300">
            {[
              "Unlimited rows per export and import",
              "Every entity, filter and column option",
              "Scheduled exports and imports, delivered where you choose",
              "Migrations from other platforms",
            ].map((f) => (
              <s-stack key={f} direction="inline" gap="small-300" alignItems="start">
                <s-icon type="check" tone="success" />
                <div style={{ flex: 1, minWidth: 0 }}><s-text>{f}</s-text></div>
              </s-stack>
            ))}
          </s-stack>
          <s-text color="subdued">
            No card, no trial to expire. If paid plans return, you&rsquo;ll be told before anything changes.
          </s-text>
        </s-stack>
      </Card>
    );
  }

  return (
    <Card heading="Plan" description="Pick a plan below — billing is handled by Shopify, and the plan page opens in the admin.">
      <div style={planGrid}>
        {PLAN_TIERS.map((t) => {
          const isCurrent = t.name === currentName;
          return (
            <s-box key={t.name} padding="base" borderWidth="base" borderRadius="base" background="base">
              <s-stack direction="block" gap="base">
                {/* Header: name + badges on the left, price on the right. */}
                <div style={planHeader}>
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <s-heading>{t.name}</s-heading>
                    {t.popular && <s-badge tone="success">Popular</s-badge>}
                    {isCurrent && <s-badge>Current</s-badge>}
                  </s-stack>
                  <s-stack direction="inline" gap="small-100" alignItems="baseline">
                    <s-heading>{t.price}</s-heading>
                    {t.cadence && <s-text color="subdued">{t.cadence}</s-text>}
                  </s-stack>
                </div>
                <s-stack direction="block" gap="small-300">
                  {t.features.map((f) => (
                    <s-stack key={f} direction="inline" gap="small-300" alignItems="start">
                      <s-icon type="check" tone="success" />
                      {/* minWidth: 0 lets long labels wrap beside the icon instead of dropping below it */}
                      <div style={{ flex: 1, minWidth: 0 }}><s-text>{f}</s-text></div>
                    </s-stack>
                  ))}
                </s-stack>
                <s-button variant="primary" disabled={isCurrent || undefined} onClick={openPlans}>
                  {isCurrent ? "Current plan" : t.name === "Basic" ? "Downgrade to Basic" : `Choose ${t.name}`}
                </s-button>
              </s-stack>
            </s-box>
          );
        })}
      </div>
    </Card>
  );
}

function AboutCard({ appInfo }) {
  return (
    <Card heading="About" description="App information and documents.">
      <s-stack direction="block" gap="small-200">
        <s-text><s-text type="strong">{appInfo.name}</s-text>{appInfo.version ? ` · v${appInfo.version}` : ""}</s-text>
        <s-text color="subdued">Export &amp; import your Shopify store data — products, orders, customers and more.</s-text>
      </s-stack>
      <s-divider />
      <s-stack direction="block" gap="small-200">
        <s-link href="mailto:support@syncifypro.app">Contact support</s-link>
        <s-link href="https://www.shopify.com/legal/privacy" target="_blank">Privacy policy</s-link>
      </s-stack>
    </Card>
  );
}
/* eslint-enable react/prop-types */

// ─── styles ──────────────────────────────────────────────────────────────────

const planHeader = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".5rem", flexWrap: "nowrap",
};
const planGrid = {
  display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem", alignItems: "stretch",
};

const layout = {
  display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: "1rem", alignItems: "start",
};
// SyncifyPro accent (teal) — distinct from Matrixify's blue-grey.
const ACCENT = "#0d9488";
const ACCENT_BG = "#eefaf8";

const menuCol = {
  display: "flex", flexDirection: "column", gap: ".9rem",
  border: "1px solid #e1e3e5", borderRadius: 12, padding: ".6rem", background: "#fff",
};
const menuGroup = { display: "flex", flexDirection: "column", gap: ".1rem" };
const menuItem = {
  display: "flex", alignItems: "center", gap: ".55rem",
  textAlign: "left", padding: ".45rem .6rem", border: "none",
  background: "transparent", borderRadius: 8, cursor: "pointer", width: "100%",
};
const menuItemActive = { background: ACCENT_BG };
const menuIcon = { display: "inline-flex", color: "#8a8f96" };
const menuIconActive = { color: ACCENT };
const menuText = { display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 };
const menuLabel = { fontSize: ".9rem", fontWeight: 500, color: "#303030" };
const menuLabelActive = { fontWeight: 700, color: ACCENT };
const menuValue = { fontSize: ".72rem", color: "#8a8f96", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const cardCol = { minWidth: 0 };
const field = { display: "flex", flexDirection: "column", gap: ".35rem" };
const input = { padding: ".45rem .6rem", borderRadius: 6, border: "1px solid #c9cccf", fontSize: ".9rem", background: "#fff", maxWidth: 340 };
const toggleBox = { border: "1px solid #e1e3e5", borderRadius: 10, padding: "1rem 1.15rem", background: "#fff" };
const permGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: ".4rem .75rem" };
const permItem = { padding: ".15rem 0" };
const scopeWrap = { display: "flex", flexWrap: "wrap", gap: ".4rem" };
const scopeChip = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: ".8rem",
  padding: ".2rem .55rem", borderRadius: 999, border: "1px solid #d0d5dd", background: "#f6f6f7", color: "#303030",
};
