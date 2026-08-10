/**
 * export/entities/subscriptions.js
 *
 * Subscription contracts as flat rows — ONE ROW PER CONTRACT LINE, with the
 * contract's fields repeated (the same multi-row shape orders use). Requires
 * read_own_subscription_contracts.
 */

const SUBSCRIPTIONS_QUERY = `#graphql
  query GetSubscriptions($first: Int!, $after: String) {
    subscriptionContracts(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id status createdAt nextBillingDate currencyCode
        customer { id email displayName }
        deliveryPolicy { interval intervalCount }
        billingPolicy { interval intervalCount maxCycles minCycles }
        lines(first: 50) {
          nodes { id title variantTitle sku quantity currentPrice { amount currencyCode } }
        }
      }
    }
  }
`;

export async function extractSubscriptions(admin, { onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(SUBSCRIPTIONS_QUERY, {
      variables: { first: 50, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.subscriptionContracts;
    for (const c of nodes) {
      const lines = c.lines?.nodes ?? [];
      if (lines.length === 0) rows.push(subscriptionRow(c, null, true));
      else lines.forEach((l, i) => rows.push(subscriptionRow(c, l, i === 0)));
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}

function subscriptionRow(c, line, isTop) {
  return {
    subscription_id: c.id?.split("/").pop() ?? "",
    top_row: isTop ? "true" : "",
    status: c.status ?? "",
    customer_email: c.customer?.email ?? "",
    customer_name: c.customer?.displayName ?? "",
    next_billing_date: c.nextBillingDate ?? "",
    currency: c.currencyCode ?? "",
    billing_interval: c.billingPolicy?.interval ?? "",
    billing_interval_count: c.billingPolicy?.intervalCount ?? "",
    billing_min_cycles: c.billingPolicy?.minCycles ?? "",
    billing_max_cycles: c.billingPolicy?.maxCycles ?? "",
    delivery_interval: c.deliveryPolicy?.interval ?? "",
    delivery_interval_count: c.deliveryPolicy?.intervalCount ?? "",
    line_title: line?.title ?? "",
    line_variant_title: line?.variantTitle ?? "",
    line_sku: line?.sku ?? "",
    line_quantity: line?.quantity ?? "",
    line_price: line?.currentPrice?.amount ?? "",
    created_at: c.createdAt ?? "",
  };
}
