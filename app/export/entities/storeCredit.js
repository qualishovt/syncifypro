/**
 * export/entities/storeCredit.js
 *
 * Store credit accounts as flat rows — one row per customer account that
 * holds credit. Customers with no store credit are skipped, so the sheet is
 * a ledger of who actually has a balance. Requires
 * read_store_credit_accounts (+ read_customers).
 */

const STORE_CREDIT_QUERY = `#graphql
  query GetStoreCredit($first: Int!, $after: String) {
    customers(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id email displayName
        storeCreditAccounts(first: 10) {
          nodes { id balance { amount currencyCode } }
        }
      }
    }
  }
`;

export async function extractStoreCredit(admin, { onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(STORE_CREDIT_QUERY, {
      variables: { first: 100, after: cursor },
    });
    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.customers;
    for (const c of nodes) {
      for (const acct of c.storeCreditAccounts?.nodes ?? []) {
        rows.push({
          store_credit_account_id: acct.id?.split("/").pop() ?? "",
          customer_id: c.id?.split("/").pop() ?? "",
          customer_email: c.email ?? "",
          customer_name: c.displayName ?? "",
          balance: acct.balance?.amount ?? "",
          currency: acct.balance?.currencyCode ?? "",
        });
      }
    }

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}
