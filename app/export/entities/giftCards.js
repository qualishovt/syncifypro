/**
 * export/entities/giftCards.js
 *
 * Fetches gift cards from Shopify (paginated) as normalized flat rows.
 * One row per gift card. Requires the read_gift_cards scope. The full code
 * is never exposed by the API — only the last characters.
 */

const GIFT_CARDS_QUERY = `#graphql
  query GetGiftCards($first: Int!, $after: String, $query: String) {
    giftCards(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        lastCharacters
        initialValue { amount currencyCode }
        balance { amount currencyCode }
        note
        expiresOn
        createdAt
        deactivatedAt
        customer { email firstName lastName }
        order { name }
      }
    }
  }
`;

export async function extractGiftCards(admin, { query = "", onProgress } = {}) {
  const rows = [];
  let cursor = null;
  let hasNextPage = true;
  let processed = 0;

  while (hasNextPage) {
    const response = await admin.graphql(GIFT_CARDS_QUERY, {
      variables: { first: 250, after: cursor, query: query || undefined },
    });

    const { data, errors } = await response.json();
    if (errors?.length) {
      throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
    }

    const { nodes, pageInfo } = data.giftCards;
    for (const gc of nodes) rows.push(normalizeGiftCard(gc));

    processed += nodes.length;
    onProgress?.(processed);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return rows;
}

function normalizeGiftCard(gc) {
  return {
    gift_card_id: gc.id?.split("/").pop() ?? "",
    last_characters: gc.lastCharacters ?? "",
    initial_value: gc.initialValue?.amount ?? "",
    balance: gc.balance?.amount ?? "",
    currency: gc.balance?.currencyCode ?? gc.initialValue?.currencyCode ?? "",
    customer_email: gc.customer?.email ?? "",
    customer_name: [gc.customer?.firstName, gc.customer?.lastName].filter(Boolean).join(" "),
    linked_order: gc.order?.name ?? "",
    note: gc.note ?? "",
    expires_on: gc.expiresOn ?? "",
    enabled: gc.deactivatedAt ? "false" : "true",
    deactivated_at: gc.deactivatedAt ?? "",
    created_at: gc.createdAt ?? "",
  };
}
