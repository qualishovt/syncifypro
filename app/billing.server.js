/**
 * app/billing.server.js
 *
 * Plan gating for Managed Pricing (Shopify App Pricing). Plans are defined in
 * the Partner dashboard — the app only READS the merchant's active
 * subscription and limits features accordingly:
 *
 *   Basic       — free; imports/exports capped at 100 rows; no schedules or migrations.
 *   Pro   $12   — 10,000 rows per job; schedules + migrations.
 *   Max   $40   — 100,000 rows per job; schedules + migrations.
 *   Enterprise $150 — unlimited; schedules + migrations.
 *
 * Tiers are matched by subscription NAME (case-insensitive), so the plan names
 * in the Partner dashboard must stay exactly Basic / Pro / Max / Enterprise.
 * An active subscription whose name we don't recognize gets full access —
 * over-delivering to a paying merchant beats capping one because a plan was
 * renamed. No subscription at all (or a billing API error) means Basic.
 */

// rowLimit: max rows per import/export job; null = unlimited.
const TIERS = {
  basic:      { planName: "Basic",      paid: false, rowLimit: 100,     schedules: false, migrations: false },
  pro:        { planName: "Pro",        paid: true,  rowLimit: 10_000,  schedules: true,  migrations: true },
  max:        { planName: "Max",        paid: true,  rowLimit: 100_000, schedules: true,  migrations: true },
  enterprise: { planName: "Enterprise", paid: true,  rowLimit: null,    schedules: true,  migrations: true },
};

export const FREE_ROW_LIMIT = TIERS.basic.rowLimit;

const PLAN_QUERY = `#graphql
  query appActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions { name status test }
    }
  }`;

/** The merchant's plan, from the live subscription state. Fails closed to Basic. */
export async function getPlan(admin) {
  try {
    const res = await admin.graphql(PLAN_QUERY);
    const body = await res.json();
    const subs = body?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.find((s) => s.status === "ACTIVE");
    if (!active) return { ...TIERS.basic };
    const tier = TIERS[String(active.name).trim().toLowerCase()];
    if (tier) return { ...tier };
    return { ...TIERS.enterprise, planName: active.name };
  } catch {
    // Billing must never take the app down; an API hiccup means Basic limits.
    return { ...TIERS.basic };
  }
}

/** The Managed Pricing plan-selection page for this shop (open with target=_top). */
export function planPageUrl(shop) {
  const storeHandle = String(shop || "").replace(/\.myshopify\.com$/, "");
  // eslint-disable-next-line no-undef
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "syncifypro";
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

/** Uniform upgrade-required error payload for route actions. */
export function upgradeError(feature, shop) {
  return {
    error: `${feature} is available on paid plans (from $12/month). Open Settings → Plan to upgrade.`,
    upgradeUrl: planPageUrl(shop),
    upgradeRequired: true,
  };
}
