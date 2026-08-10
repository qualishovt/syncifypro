/**
 * export/entities/sellingPlans.js
 *
 * Selling plan groups (subscriptions / try-before-you-buy / pre-orders) —
 * ONE ROW PER PLAN inside a group, with the group's fields repeated so the
 * sheet reads standalone. Requires read_products.
 */

const SELLING_PLANS_QUERY = `#graphql
  query GetSellingPlans($first: Int!, $after: String) {
    sellingPlanGroups(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name merchantCode description summary options position appId createdAt
        productsCount { count }
        productVariantsCount { count }
        sellingPlans(first: 50) {
          nodes {
            id name description options category
            billingPolicy { ... on SellingPlanRecurringBillingPolicy { interval intervalCount } }
            deliveryPolicy { ... on SellingPlanRecurringDeliveryPolicy { interval intervalCount } }
          }
        }
      }
    }
  }
`;

export async function extractSellingPlans(admin, { onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(SELLING_PLANS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.sellingPlanGroups;
    for (const group of nodes) {
      const plans = group.sellingPlans?.nodes ?? [];
      if (plans.length === 0) rows.push(planRow(group, null));
      else for (const plan of plans) rows.push(planRow(group, plan));
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}

const list = (v) => (Array.isArray(v) ? v.join(", ") : v ?? "");

function planRow(group, plan) {
  return {
    selling_plan_group_id: group.id?.split("/").pop() ?? "",
    group_name: group.name ?? "",
    merchant_code: group.merchantCode ?? "",
    group_description: group.description ?? "",
    group_summary: group.summary ?? "",
    group_options: list(group.options),
    position: group.position ?? "",
    app_id: group.appId ?? "",
    products_count: group.productsCount?.count ?? "",
    variants_count: group.productVariantsCount?.count ?? "",
    selling_plan_id: plan?.id?.split("/").pop() ?? "",
    plan_name: plan?.name ?? "",
    plan_description: plan?.description ?? "",
    plan_options: list(plan?.options),
    plan_category: plan?.category ?? "",
    billing_interval: plan?.billingPolicy?.interval ?? "",
    billing_interval_count: plan?.billingPolicy?.intervalCount ?? "",
    delivery_interval: plan?.deliveryPolicy?.interval ?? "",
    delivery_interval_count: plan?.deliveryPolicy?.intervalCount ?? "",
    created_at: group.createdAt ?? "",
  };
}
