/**
 * app/billing.server.js
 *
 * Plan gating for Managed Pricing (Shopify App Pricing). Plans are defined in
 * the Partner dashboard — the app only READS the merchant's active
 * subscription and limits features accordingly:
 *
 *   Free — imports and exports capped at FREE_ROW_LIMIT rows; no schedules,
 *          no migrations.
 *   Pro  — everything, uncapped.
 *
 * Any ACTIVE app subscription counts as Pro (there is only one paid plan;
 * checking by name would break the moment the plan is renamed in the
 * dashboard). Test charges count too, so development stores behave like Pro
 * once the test plan is accepted.
 */

export const FREE_ROW_LIMIT = 50;

const PLAN_QUERY = `#graphql
  query appActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions { name status test }
    }
  }`;

/** The merchant's plan, from the live subscription state. Fails closed to Free. */
export async function getPlan(admin) {
  try {
    const res = await admin.graphql(PLAN_QUERY);
    const body = await res.json();
    const subs = body?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const active = subs.find((s) => s.status === "ACTIVE");
    return { pro: Boolean(active), planName: active?.name ?? "Free" };
  } catch {
    // Billing must never take the app down; an API hiccup means Free limits.
    return { pro: false, planName: "Free" };
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
    error: `${feature} is available on the Pro plan ($15/month). Open Settings → Plan to upgrade.`,
    upgradeUrl: planPageUrl(shop),
    upgradeRequired: true,
  };
}
