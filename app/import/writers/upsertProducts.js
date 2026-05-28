/**
 * import/writers/upsertProducts.js
 *
 * Takes validated + coerced product rows and writes them to Shopify.
 *
 * Strategy:
 *   - If the row has a product_id  → update existing product
 *   - If the row has no product_id → create new product
 *
 * Variants are grouped by product_id / title before the API call
 * so we send one mutation per product, not one per variant row.
 *
 * Shopify rate limits: we batch in groups of 10 and add a small
 * delay between batches to stay well within the 40 req/s bucket.
 */

const CREATE_PRODUCT = `#graphql
  mutation CreateProduct($input: ProductInput!) {
    productCreate(input: $input) {
      product { id title }
      userErrors { field message }
    }
  }
`;

const UPDATE_PRODUCT = `#graphql
  mutation UpdateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title }
      userErrors { field message }
    }
  }
`;

/**
 * Upsert an array of validated product rows.
 *
 * @param {object[]} rows   - coerced, validated rows from validateProductRows()
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 * @returns {Promise<{ created: number, updated: number, errors: object[] }>}
 */
export async function upsertProducts(rows, admin) {
  const products = groupRowsIntoProducts(rows);

  let created = 0;
  let updated = 0;
  const errors = [];

  // Process in batches of 10 to respect rate limits
  const batches = chunk(products, 10);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (product) => {
        try {
          const isUpdate = Boolean(product.id);
          const mutation = isUpdate ? UPDATE_PRODUCT : CREATE_PRODUCT;
          const input    = buildProductInput(product);

          const response = await admin.graphql(mutation, { variables: { input } });
          const { data } = await response.json();

          const result = data?.productCreate ?? data?.productUpdate;
          const userErrors = result?.userErrors ?? [];

          if (userErrors.length) {
            errors.push({ product: product.title, userErrors });
          } else if (isUpdate) {
            updated++;
          } else {
            created++;
          }
        } catch (err) {
          errors.push({ product: product.title, message: err.message });
        }
      })
    );

    // Brief pause between batches (50ms) — keeps us well under rate limits
    if (batches.indexOf(batch) < batches.length - 1) {
      await sleep(50);
    }
  }

  return { created, updated, errors };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Group flat variant rows back into product objects.
 * Rows with the same product_id (or title if no id) are merged.
 */
function groupRowsIntoProducts(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = row.product_id || row.title;

    if (!map.has(key)) {
      map.set(key, {
        id:           row.product_id ? `gid://shopify/Product/${row.product_id}` : undefined,
        title:        row.title,
        handle:       row.handle       || undefined,
        status:       row.status       || "DRAFT",
        descriptionHtml: row.description || undefined,
        vendor:       row.vendor       || undefined,
        productType:  row.product_type || undefined,
        tags:         row.tags         || [],
        variants:     [],
      });
    }

    // Attach variant if this row has variant data
    if (row.sku || row.price !== undefined || row.variant_title) {
      const product = map.get(key);
      product.variants.push({
        id:             row.variant_id ? `gid://shopify/ProductVariant/${row.variant_id}` : undefined,
        title:          row.variant_title || "Default Title",
        sku:            row.sku           || undefined,
        price:          row.price?.toString(),
        compareAtPrice: row.compare_at_price?.toString(),
        barcode:        row.barcode       || undefined,
        weight:         row.weight,
        weightUnit:     row.weight_unit   || undefined,
        taxable:        row.taxable,
        inventoryQuantities: row.inventory_qty !== undefined
          ? [{ availableQuantity: row.inventory_qty, locationId: "gid://shopify/Location/1" }]
          : undefined,
      });
    }
  }

  return Array.from(map.values());
}

/** Map our internal product shape to the Shopify ProductInput shape */
function buildProductInput(product) {
  const input = {
    title:           product.title,
    status:          product.status,
    descriptionHtml: product.descriptionHtml,
    vendor:          product.vendor,
    productType:     product.productType,
    tags:            product.tags,
  };

  if (product.id)       input.id       = product.id;
  if (product.handle)   input.handle   = product.handle;
  if (product.variants?.length) input.variants = product.variants;

  return input;
}

function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}