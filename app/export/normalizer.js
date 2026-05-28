/**
 * export/normalizer.js
 *
 * Maps Shopify's raw GraphQL response shapes into your own flat
 * internal model. Every format adapter works with THIS shape —
 * so if Shopify changes a field, you fix it here only.
 */

/**
 * Normalize a Shopify product + variant into a flat export row.
 *
 * @param {object} product  - raw product node from GraphQL
 * @param {object|null} variant - raw variant node, or null if no variants
 * @returns {object} flat row
 */
export function normalizeProduct(product, variant) {
  return {
    // Product-level fields
    product_id:    gid(product.id),
    title:         product.title ?? "",
    handle:        product.handle ?? "",
    status:        product.status ?? "",
    description:   stripHtml(product.descriptionHtml ?? ""),
    vendor:        product.vendor ?? "",
    product_type:  product.productType ?? "",
    tags:          (product.tags ?? []).join(", "),
    image_url:     product.images?.nodes?.[0]?.url ?? "",
    created_at:    product.createdAt ?? "",
    updated_at:    product.updatedAt ?? "",

    // Variant-level fields (empty string when no variant)
    variant_id:        variant ? gid(variant.id) : "",
    variant_title:     variant?.title ?? "",
    sku:               variant?.sku ?? "",
    price:             variant?.price ?? "",
    compare_at_price:  variant?.compareAtPrice ?? "",
    inventory_qty:     variant?.inventoryQuantity ?? "",
    barcode:           variant?.barcode ?? "",
    weight:            variant?.inventoryItem?.measurement?.weight?.value ?? "",
    weight_unit:       variant?.inventoryItem?.measurement?.weight?.unit ?? "",
    taxable:           variant?.taxable ?? "",
  };
}

/**
 * Normalize a Shopify order + line item into a flat export row.
 *
 * @param {object} order     - raw order node from GraphQL
 * @param {object|null} lineItem - raw line item node, or null if no line items
 * @returns {object} flat row
 */
export function normalizeOrder(order, lineItem) {
  const money = (set) => set?.shopMoney?.amount ?? "";
  const currency = (set) => set?.shopMoney?.currencyCode ?? "";

  return {
    // Order-level fields
    order_id:           gid(order.id),
    order_name:         order.name ?? "",
    email:              order.email ?? "",
    phone:              order.phone ?? "",
    financial_status:   order.displayFinancialStatus ?? "",
    fulfillment_status: order.displayFulfillmentStatus ?? "",
    currency:           currency(order.totalPriceSet),
    total_price:        money(order.totalPriceSet),
    subtotal_price:     money(order.subtotalPriceSet),
    total_tax:          money(order.totalTaxSet),
    total_shipping:     money(order.totalShippingPriceSet),
    total_discounts:    money(order.totalDiscountsSet),
    note:               order.note ?? "",
    tags:               (order.tags ?? []).join(", "),
    cancel_reason:      order.cancelReason ?? "",
    cancelled_at:       order.cancelledAt ?? "",
    processed_at:       order.processedAt ?? "",
    created_at:         order.createdAt ?? "",
    updated_at:         order.updatedAt ?? "",

    // Customer
    customer_id:         gid(order.customer?.id),
    customer_email:      order.customer?.email ?? "",
    customer_first_name: order.customer?.firstName ?? "",
    customer_last_name:  order.customer?.lastName ?? "",

    // Billing address
    billing_first_name: order.billingAddress?.firstName ?? "",
    billing_last_name:  order.billingAddress?.lastName ?? "",
    billing_company:    order.billingAddress?.company ?? "",
    billing_address1:   order.billingAddress?.address1 ?? "",
    billing_address2:   order.billingAddress?.address2 ?? "",
    billing_city:       order.billingAddress?.city ?? "",
    billing_province:   order.billingAddress?.province ?? "",
    billing_zip:        order.billingAddress?.zip ?? "",
    billing_country:    order.billingAddress?.country ?? "",
    billing_phone:      order.billingAddress?.phone ?? "",

    // Shipping address
    shipping_first_name: order.shippingAddress?.firstName ?? "",
    shipping_last_name:  order.shippingAddress?.lastName ?? "",
    shipping_company:    order.shippingAddress?.company ?? "",
    shipping_address1:   order.shippingAddress?.address1 ?? "",
    shipping_address2:   order.shippingAddress?.address2 ?? "",
    shipping_city:       order.shippingAddress?.city ?? "",
    shipping_province:   order.shippingAddress?.province ?? "",
    shipping_zip:        order.shippingAddress?.zip ?? "",
    shipping_country:    order.shippingAddress?.country ?? "",
    shipping_phone:      order.shippingAddress?.phone ?? "",

    // Line item fields (empty string when no line item)
    line_item_id:              lineItem ? gid(lineItem.id) : "",
    line_item_title:           lineItem?.title ?? "",
    line_item_variant_title:   lineItem?.variantTitle ?? "",
    line_item_sku:             lineItem?.sku ?? "",
    line_item_vendor:          lineItem?.vendor ?? "",
    line_item_quantity:        lineItem?.quantity ?? "",
    line_item_price:           money(lineItem?.originalUnitPriceSet),
    line_item_discounted_price: money(lineItem?.discountedUnitPriceSet),
    line_item_total_discount:  money(lineItem?.totalDiscountSet),
    line_item_taxable:         lineItem?.taxable ?? "",
    line_item_requires_shipping: lineItem?.requiresShipping ?? "",
    line_item_fulfillment_status: lineItem?.fulfillmentStatus ?? "",
    line_item_product_id:      lineItem?.product ? gid(lineItem.product.id) : "",
    line_item_variant_id:      lineItem?.variant  ? gid(lineItem.variant.id)  : "",
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Strip "gid://shopify/Product/12345" down to "12345" */
function gid(globalId) {
  if (!globalId) return "";
  return globalId.split("/").pop();
}

/** Very lightweight HTML stripper for description fields */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}