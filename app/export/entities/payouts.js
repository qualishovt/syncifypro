/**
 * export/entities/payouts.js
 *
 * Fetches Shopify Payments payouts (paginated) as normalized flat rows.
 * Payouts live under shopifyPaymentsAccount (not a top-level connection), so
 * there's no bulk path or count query — always the direct path. Stores without
 * Shopify Payments return no account, which yields zero rows.
 * Requires read_shopify_payments_accounts + read_shopify_payments_payouts.
 */

import { normalizePayout } from "../normalizer.js";

const PAYOUTS_QUERY = `#graphql
  query GetPayouts($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      payouts(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id legacyResourceId issuedAt status
          net { amount currencyCode }
          summary {
            chargesGross { amount } chargesFee { amount }
            refundsFeeGross { amount } refundsFee { amount }
            adjustmentsGross { amount } adjustmentsFee { amount }
            reservedFundsGross { amount } reservedFundsFee { amount }
            retriedPayoutsGross { amount } retriedPayoutsFee { amount }
          }
        }
      }
    }
  }
`;

export async function extractPayouts(admin) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(PAYOUTS_QUERY, {
      variables: { first: 250, after: cursor },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const conn = data.shopifyPaymentsAccount?.payouts;
    if (!conn) break; // store has no Shopify Payments account

    for (const payout of conn.nodes) rows.push(normalizePayout(payout));

    hasNextPage = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }

  return rows;
}
