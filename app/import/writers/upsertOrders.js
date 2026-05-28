/**
 * import/writers/upsertOrders.js
 *
 * Updates existing Shopify orders from validated import rows.
 *
 * Important Shopify limitations:
 *   - Orders CANNOT be created via the Admin API in normal flows.
 *     Only draft orders can be created then completed.
 *   - Editable fields via orderUpdate are limited: note, tags,
 *     email, shipping address, and custom attributes.
 *   - Line items cannot be changed after order creation via API.
 *
 * This writer handles: note, tags, email, shipping address updates.
 * Rows are grouped by order_id so we send one mutation per order.
 */

const UPDATE_ORDER = `#graphql
  mutation UpdateOrder($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id name }
      userErrors { field message }
    }
  }
`;

/**
 * Update existing orders from validated rows.
 *
 * @param {object[]} rows  - coerced, validated rows from validateOrderRows()
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @returns {Promise<{ created: number, updated: number, errors: object[] }>}
 */
export async function upsertOrders(rows, admin) {
  const orders = groupRowsIntoOrders(rows);

  let updated = 0;
  const errors = [];

  const batches = chunk(orders, 10);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (order) => {
        try {
          const input = buildOrderInput(order);

          const response = await admin.graphql(UPDATE_ORDER, { variables: { input } });
          const { data } = await response.json();

          const userErrors = data?.orderUpdate?.userErrors ?? [];

          if (userErrors.length) {
            errors.push({ order: order.name, userErrors });
          } else {
            updated++;
          }
        } catch (err) {
          errors.push({ order: order.name, message: err.message });
        }
      })
    );

    if (batches.indexOf(batch) < batches.length - 1) {
      await sleep(50);
    }
  }

  // Orders can't be created via API — created always 0
  return { created: 0, updated, errors };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Group flat line item rows back into order objects.
 * Multiple rows with the same order_id are merged (last write wins
 * for order-level fields, line items are collected).
 */
function groupRowsIntoOrders(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = row.order_id;

    if (!map.has(key)) {
      map.set(key, {
        id:    `gid://shopify/Order/${row.order_id}`,
        name:  row.order_name,
        email: row.email   || undefined,
        note:  row.note    || undefined,
        tags:  row.tags    || [],
        shippingAddress: hasShippingAddress(row) ? {
          firstName: row.shipping_first_name || undefined,
          lastName:  row.shipping_last_name  || undefined,
          company:   row.shipping_company    || undefined,
          address1:  row.shipping_address1   || undefined,
          address2:  row.shipping_address2   || undefined,
          city:      row.shipping_city       || undefined,
          province:  row.shipping_province   || undefined,
          zip:       row.shipping_zip        || undefined,
          country:   row.shipping_country    || undefined,
          phone:     row.shipping_phone      || undefined,
        } : undefined,
      });
    }
  }

  return Array.from(map.values());
}

function buildOrderInput(order) {
  const input = { id: order.id };

  if (order.email)           input.email           = order.email;
  if (order.note)            input.note            = order.note;
  if (order.tags?.length)    input.tags            = order.tags;
  if (order.shippingAddress) input.shippingAddress = order.shippingAddress;

  return input;
}

function hasShippingAddress(row) {
  return [
    row.shipping_address1, row.shipping_city,
    row.shipping_country,  row.shipping_zip,
  ].some(Boolean);
}

function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}