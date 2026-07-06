/**
 * export/normalizer.js
 *
 * Maps Shopify's raw GraphQL response shapes into your own flat
 * internal model. Every format adapter works with THIS shape —
 * so if Shopify changes a field, you fix it here only.
 */

import { inventoryRowEntries } from "./inventoryColumns.js";
import {
  metafieldRowEntries,
  PRODUCT_MF_PREFIX,
  VARIANT_MF_PREFIX,
} from "./metafieldColumns.js";
import { catalogIncludedKey, catalogPublishedAlias } from "./catalogColumns.js";

/**
 * Normalize a Shopify product + variant into a flat export row.
 *
 * @param {object} product  - raw product node from GraphQL
 * @param {object|null} variant - raw variant node, or null if no variants
 * @param {object} [ctx]    - export-row context
 * @param {object|null} [ctx.image] - MediaImage node for this row, or null
 * @param {number|string} [ctx.imagePosition] - 1-based image position, or ""
 * @param {number} [ctx.rowNumber] - sequential export row number
 * @param {boolean} [ctx.topRow] - true on the first (product-level) row
 * @returns {object} flat row
 */
export function normalizeProduct(product, variant, ctx = {}) {
  const opts = variant?.selectedOptions ?? [];
  const img = ctx.image?.image ?? null;

  // A collection with a ruleSet is a smart (automated) collection;
  // without one it's a custom (manual) collection.
  const collections = product.collections?.nodes ?? [];
  const customCollections = collections.filter((c) => !c.ruleSet).map((c) => c.title);
  const smartCollections = collections.filter((c) => c.ruleSet).map((c) => c.title);

  const row = {
    // Product-level fields
    product_id:    gid(product.id),
    title:         product.title ?? "",
    handle:        product.handle ?? "",
    status:        product.status ?? "",
    description:   stripHtml(product.descriptionHtml ?? ""),
    body_html:     product.descriptionHtml ?? "",
    vendor:        product.vendor ?? "",
    product_type:  product.productType ?? "",
    tags:          (product.tags ?? []).join(", "),
    created_at:    product.createdAt ?? "",
    updated_at:    product.updatedAt ?? "",
    category_id:   gid(product.category?.id),
    category_name: product.category?.name ?? "",
    category_tree: product.category?.fullName ?? "",
    custom_collections: customCollections.join(", "),
    smart_collections:  smartCollections.join(", "),
    published:        product.publishedAt ? "TRUE" : "FALSE",
    published_at:     product.publishedAt ?? "",
    published_scope:  "",
    template_suffix:  product.templateSuffix ?? "",
    gift_card:        product.isGiftCard ? "TRUE" : "FALSE",
    url:              product.onlineStoreUrl ?? "",
    total_inventory_qty: product.totalInventory ?? "",
    seo_title:        product.seo?.title ?? "",
    seo_description:  product.seo?.description ?? "",
    // Matrixify import-control columns — blank on export
    command:       "",
    tags_command:  "",
    row_number:    ctx.rowNumber ?? "",
    top_row:       ctx.topRow ? "TRUE" : "",

    // Media (one image per row; extra images get their own rows)
    image_type:       ctx.image?.mimeType ?? "",
    image_url:        img?.url ?? "",
    image_command:    "",
    image_position:   ctx.imagePosition ?? "",
    image_width:      img?.width ?? "",
    image_height:     img?.height ?? "",
    image_alt:        img?.altText ?? "",

    // Variant-level fields (empty string when no variant)
    variant_inventory_item_id: gid(variant?.inventoryItem?.id),
    variant_id:        variant ? gid(variant.id) : "",
    variant_command:   "",
    option1_name:      opts[0]?.name ?? "",
    option1_value:     opts[0]?.value ?? "",
    option2_name:      opts[1]?.name ?? "",
    option2_value:     opts[1]?.value ?? "",
    option3_name:      opts[2]?.name ?? "",
    option3_value:     opts[2]?.value ?? "",
    variant_position:  variant?.position ?? "",
    sku:               variant?.sku ?? "",
    barcode:           variant?.barcode ?? "",
    variant_image:     variant?.media?.nodes?.[0]?.image?.url ?? "",
    weight:            variant?.inventoryItem?.measurement?.weight?.value ?? "",
    weight_unit:       variant?.inventoryItem?.measurement?.weight?.unit ?? "",
    price:             variant?.price ?? "",
    compare_at_price:  variant?.compareAtPrice ?? "",
    taxable:           variant?.taxable ?? "",
    inventory_tracker: variant?.inventoryItem?.tracked ? "shopify" : "",
    inventory_policy:  variant?.inventoryPolicy ?? "",
    // Removed from the Admin API on ProductVariant — left blank (resolving
    // the real value needs a slow per-variant inventory-level/location walk).
    variant_fulfillment_service: "",
    requires_shipping: variant?.inventoryItem?.requiresShipping ?? "",
    variant_shipping_profile:    variant?.deliveryProfile?.name ?? "",
    inventory_qty:     variant?.inventoryQuantity ?? "",
    // Matrixify import-control column — blank on export.
    variant_inventory_adjust:    "",

    variant_grams:               gramsFrom(variant?.inventoryItem?.measurement?.weight),
    variant_tax_code:            "", // deprecated in the Admin API — header only
    variant_generate_from_options: "", // import directive
    image_attachment:            "", // import-only (base64)
    collection:                  "", // linked-collection import column

    // Variant Cost + Customs Information (Matrixify groups)
    variant_cost:                variant?.inventoryItem?.unitCost?.amount ?? "",
    variant_country_of_origin:   variant?.inventoryItem?.countryCodeOfOrigin ?? "",
    variant_province_of_origin:  variant?.inventoryItem?.provinceCodeOfOrigin ?? "",
    variant_hs_code:             variant?.inventoryItem?.harmonizedSystemCode ?? "",

    // Google Shopping metafields (Matrixify pre-lists these as fixed columns;
    // your app also surfaces them via the dynamic Metafields group when present).
    gs_google_product_category: "", gs_custom_product: "", gs_gmc_id: "",
    gs_mpn: "", gs_age_group: "", gs_gender: "", gs_condition: "",
    gs_color: "", gs_material: "", gs_size: "", gs_size_system: "",
  };

  // Dynamic, store-shaped columns — only present when their group was
  // selected (and so fetched). Each key is the human header itself.
  Object.assign(
    row,
    inventoryRowEntries(variant?.inventoryItem?.inventoryLevels?.nodes),
    metafieldRowEntries(product.metafields?.nodes, PRODUCT_MF_PREFIX),
    metafieldRowEntries(variant?.metafields?.nodes, VARIANT_MF_PREFIX),
    catalogIncludedEntries(product, ctx.catalogs),  // "Included / <cat>" per catalog
    ctx.catalogEntries ?? {},                       // "Price / <cat>", "Compare At Price / <cat>"
  );
  return row;
}

/**
 * "Included / <catalog>" per catalog. The products query aliases a
 * publishedOnPublication boolean per catalog (catpub_<i>); we read it back by
 * index. TRUE/FALSE on the direct path; blank when the alias is absent (the
 * bulk path can't alias per-publication, so Included is left empty there).
 */
function catalogIncludedEntries(product, catalogs) {
  if (!catalogs?.length) return {};
  const out = {};
  catalogs.forEach((cat, i) => {
    const v = product[catalogPublishedAlias(i)];
    out[catalogIncludedKey(cat.title)] = v === true ? "TRUE" : v === false ? "FALSE" : "";
  });
  return out;
}

/**
 * Expand one fully-nested product into its export rows (Matrixify layout:
 * one row per variant, plus extra rows for any images beyond the variant
 * count; the first row is the product-level "top row"). Shared by the
 * direct extractor and the bulk worker so both produce identical output.
 *
 * @param {object} product - nested product (product.variants.nodes,
 *                           product.media.nodes, product.collections.nodes)
 * @param {number} startRowNumber - export row number for this product's first row
 * @param {object} [options]
 * @param {Map<string, object>} [options.catalogPriceMap] - variantId → catalog price entries
 * @param {{title:string, publicationId:string}[]} [options.catalogs] - catalog metadata for "Included"
 * @returns {object[]} flat rows
 */
export function buildProductRows(product, startRowNumber = 1, { catalogPriceMap, catalogs } = {}) {
  const variants = product.variants?.nodes ?? [];
  const images = (product.media?.nodes ?? []).filter((m) => m?.image);
  const rowCount = Math.max(variants.length, images.length, 1);

  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const variant = variants[i] ?? null;
    rows.push(
      normalizeProduct(product, variant, {
        image: images[i] ?? null,
        imagePosition: i < images.length ? i + 1 : "",
        rowNumber: startRowNumber + i,
        topRow: i === 0,
        catalogEntries: variant ? catalogPriceMap?.get(variant.id) : undefined,
        catalogs,
      }),
    );
  }
  return rows;
}

/**
 * Normalize a Shopify order + line item into a flat export row.
 *
 * @param {object} order     - raw order node from GraphQL
 * @param {object|null} lineItem - raw line item node, or null if no line items
 * @returns {object} flat row
 */
// Max numbered tax-line column sets emitted per order and per line item.
// Real orders rarely exceed a couple of tax lines; beyond this they're dropped.
const ORDER_TAX_CAP = 5;

// Expand a taxLines array into numbered columns: <prefix>_<n>_{title,rate,price,channel_liable}.
function taxLineCols(taxLines, prefix, cap) {
  const out = {};
  for (let i = 0; i < cap; i++) {
    const t = (taxLines ?? [])[i];
    const rate = t?.ratePercentage ?? (t?.rate != null ? Number(t.rate) * 100 : "");
    out[`${prefix}_${i + 1}_title`] = t?.title ?? "";
    out[`${prefix}_${i + 1}_rate`] = rate === "" ? "" : rate;
    out[`${prefix}_${i + 1}_price`] = t?.priceSet?.shopMoney?.amount ?? "";
    out[`${prefix}_${i + 1}_channel_liable`] = t?.channelLiable ?? "";
  }
  return out;
}

export function normalizeOrder(order, lineItem) {
  const money = (set) => set?.shopMoney?.amount ?? "";
  const cust = order.customer;
  const variant = lineItem?.variant;
  const invItem = variant?.inventoryItem;

  // order.taxLines → "VAT 20% 4.00; GST 5% 1.00"
  const taxLines = (order.taxLines ?? [])
    .map((t) => `${t.title} ${Math.round((Number(t.rate) || 0) * 100)}% ${money(t.priceSet)}`)
    .join("; ");
  // lineItem.customAttributes → "Engraving: John; Gift wrap: Yes"
  const properties = (lineItem?.customAttributes ?? [])
    .map((a) => `${a.key}: ${a.value}`)
    .join("; ");
  // order.shippingLine.taxLines → "VAT 20% 2.00"
  const shipTax = (order.shippingLine?.taxLines ?? [])
    .map((t) => `${t.title} ${Math.round((Number(t.rate) || 0) * 100)}% ${money(t.priceSet)}`)
    .join("; ");
  const journey = order.customerJourneySummary?.lastVisit ?? {};
  const utm = journey.utmParameters ?? {};
  const pc = order.purchasingEntity?.__typename === "PurchasingCompany" ? order.purchasingEntity : null;
  const riskAssess = (order.risk?.assessments ?? [])[0] ?? {};

  return {
    // Order
    order_id:           gid(order.id),
    order_name:         order.name ?? "",
    order_number:       (order.name ?? "").replace(/\D/g, ""),
    email:              order.email ?? "",
    phone:              order.phone ?? "",
    note:               order.note ?? "",
    tags:               (order.tags ?? []).join(", "),
    financial_status:   order.displayFinancialStatus ?? "",
    fulfillment_status: order.displayFulfillmentStatus ?? "",
    currency:           order.currencyCode ?? "",
    presentment_currency: order.presentmentCurrencyCode ?? "",
    taxes_included:     order.taxesIncluded ?? "",
    test:               order.test ?? "",
    confirmed:          order.confirmed ?? "",
    source_name:        order.sourceName ?? "",
    source_identifier:  order.sourceIdentifier ?? "",
    confirmation_number: order.confirmationNumber ?? "",
    send_receipt:        "", // import directive
    inventory_behaviour: "", // import directive
    cancel_send_receipt: "", // import directive
    cancel_refund:       "", // import directive
    order_status_url:   order.statusPageUrl ?? "",
    line_items_quantity: order.currentSubtotalLineItemsQuantity ?? "",
    total_weight:       order.totalWeight ?? "",
    cancel_reason:      order.cancelReason ?? "",
    cancelled_at:       order.cancelledAt ?? "",
    closed_at:          order.closedAt ?? "",
    processed_at:       order.processedAt ?? "",
    created_at:         order.createdAt ?? "",
    updated_at:         order.updatedAt ?? "",

    // Totals
    total_price:        money(order.totalPriceSet),
    subtotal_price:     money(order.subtotalPriceSet),
    total_tax:          money(order.totalTaxSet),
    total_shipping:     money(order.totalShippingPriceSet),
    total_discounts:    money(order.totalDiscountsSet),
    current_total_price: money(order.currentTotalPriceSet),
    total_refunded:     money(order.totalRefundedSet),
    current_total_duties: money(order.currentTotalDutiesSet),
    total_duties:       money(order.originalTotalDutiesSet),
    current_total_fees: money(order.currentTotalAdditionalFeesSet),
    total_fees:         money(order.originalTotalAdditionalFeesSet),
    total_received:     money(order.totalReceivedSet),
    net_payment:        money(order.netPaymentSet),
    total_capturable:   money(order.totalCapturableSet),
    tax_lines:          taxLines,

    // Browser / UTM
    browser_ip:    order.clientIp ?? "",
    landing_page:  journey.landingPage ?? "",
    referrer_url:  journey.referrerUrl ?? "",
    source:        journey.source ?? "",
    source_type:   journey.sourceType ?? "",
    utm_source:    utm.source ?? "",
    utm_medium:    utm.medium ?? "",
    utm_campaign:  utm.campaign ?? "",
    utm_term:      utm.term ?? "",
    utm_content:   utm.content ?? "",

    // Company (B2B purchasing entity)
    company_id:            pc?.company ? gid(pc.company.id) : "",
    company_name:          pc?.company?.name ?? "",
    company_location_id:   pc?.location ? gid(pc.location.id) : "",
    company_location_name: pc?.location?.name ?? "",

    // Risk
    risk_recommendation: order.risk?.recommendation ?? "",
    risk_level:          riskAssess.riskLevel ?? "",
    risk_facts:          (riskAssess.facts ?? []).map((f) => `${f.description}${f.sentiment ? ` (${f.sentiment})` : ""}`).join("; "),

    // Buyer (customer)
    customer_id:         gid(cust?.id),
    customer_email:      cust?.defaultEmailAddress?.emailAddress ?? "",
    customer_phone:      cust?.defaultPhoneNumber?.phoneNumber ?? "",
    customer_first_name: cust?.firstName ?? "",
    customer_last_name:  cust?.lastName ?? "",
    customer_note:       cust?.note ?? "",
    customer_state:      cust?.state ?? "",
    customer_orders_count: cust?.numberOfOrders ?? "",
    customer_total_spent: cust?.amountSpent?.amount ?? "",
    customer_tags:       (cust?.tags ?? []).join(", "),
    customer_tax_exempt: cust?.taxExempt ?? "",
    customer_email_marketing: cust?.defaultEmailAddress?.marketingState ?? "",
    customer_sms_marketing: cust?.defaultPhoneNumber?.marketingState ?? "",

    // Billing address
    billing_first_name: order.billingAddress?.firstName ?? "",
    billing_last_name:  order.billingAddress?.lastName ?? "",
    billing_name:       order.billingAddress?.name ?? "",
    billing_company:    order.billingAddress?.company ?? "",
    billing_phone:      order.billingAddress?.phone ?? "",
    billing_address1:   order.billingAddress?.address1 ?? "",
    billing_address2:   order.billingAddress?.address2 ?? "",
    billing_city:       order.billingAddress?.city ?? "",
    billing_province:   order.billingAddress?.province ?? "",
    billing_province_code: order.billingAddress?.provinceCode ?? "",
    billing_zip:        order.billingAddress?.zip ?? "",
    billing_country:    order.billingAddress?.country ?? "",
    billing_country_code: order.billingAddress?.countryCodeV2 ?? "",

    // Shipping address + shipping line
    shipping_first_name: order.shippingAddress?.firstName ?? "",
    shipping_last_name:  order.shippingAddress?.lastName ?? "",
    shipping_name:       order.shippingAddress?.name ?? "",
    shipping_company:    order.shippingAddress?.company ?? "",
    shipping_phone:      order.shippingAddress?.phone ?? "",
    shipping_address1:   order.shippingAddress?.address1 ?? "",
    shipping_address2:   order.shippingAddress?.address2 ?? "",
    shipping_city:       order.shippingAddress?.city ?? "",
    shipping_province:   order.shippingAddress?.province ?? "",
    shipping_province_code: order.shippingAddress?.provinceCode ?? "",
    shipping_zip:        order.shippingAddress?.zip ?? "",
    shipping_country:    order.shippingAddress?.country ?? "",
    shipping_country_code: order.shippingAddress?.countryCodeV2 ?? "",
    shipping_line_title: order.shippingLine?.title ?? "",
    shipping_line_code:  order.shippingLine?.code ?? "",
    shipping_line_source: order.shippingLine?.source ?? "",
    shipping_line_price: money(order.shippingLine?.originalPriceSet),
    shipping_line_tax:   shipTax,

    // Items (line item; empty string when no line item)
    line_item_id:              lineItem ? gid(lineItem.id) : "",
    line_item_title:           lineItem?.title ?? "",
    line_item_name:            lineItem?.name ?? "",
    line_item_variant_title:   lineItem?.variantTitle ?? "",
    line_item_sku:             lineItem?.sku ?? "",
    line_item_vendor:          lineItem?.vendor ?? "",
    line_item_quantity:        lineItem?.quantity ?? "",
    line_item_current_quantity: lineItem?.currentQuantity ?? "",
    line_item_unfulfilled_quantity: lineItem?.unfulfilledQuantity ?? "",
    line_item_price:           money(lineItem?.originalUnitPriceSet),
    line_item_discounted_price: money(lineItem?.discountedUnitPriceSet),
    line_item_total:           money(lineItem?.discountedTotalSet),
    line_item_total_discount:  money(lineItem?.totalDiscountSet),
    line_item_taxable:         lineItem?.taxable ?? "",
    line_item_requires_shipping: lineItem?.requiresShipping ?? "",
    line_item_gift_card:       lineItem?.isGiftCard ?? "",
    line_item_properties:      properties,
    line_item_fulfillment_status: lineItem?.fulfillmentStatus ?? "",
    line_item_product_id:      lineItem?.product ? gid(lineItem.product.id) : "",
    line_item_variant_id:      variant ? gid(variant.id) : "",
    line_item_product_handle:  lineItem?.product?.handle ?? "",

    // Item product data (export-only, joined from the line's variant/product)
    line_item_product_type:    lineItem?.product?.productType ?? "",
    line_item_product_tags:    (lineItem?.product?.tags ?? []).join(", "),
    line_item_variant_barcode: variant?.barcode ?? "",
    line_item_variant_weight:  invItem?.measurement?.weight?.value ?? "",
    line_item_variant_weight_unit: invItem?.measurement?.weight?.unit ?? "",
    line_item_variant_inventory_qty: variant?.inventoryQuantity ?? "",
    line_item_variant_cost:    invItem?.unitCost?.amount ?? "",
    line_item_variant_price:   variant?.price ?? "",
    line_item_variant_compare_at_price: variant?.compareAtPrice ?? "",
    line_item_variant_country_of_origin: invItem?.countryCodeOfOrigin ?? "",
    line_item_variant_province_of_origin: invItem?.provinceCodeOfOrigin ?? "",
    line_item_variant_hs_code: invItem?.harmonizedSystemCode ?? "",

    // Row type (overridden by buildOrderRows for sub-entity rows)
    line_type:   "Line Item",
    top_row:     "",
    row_number:  "",
    // Transaction (blank unless this is a Transaction row)
    transaction_id: "", transaction_kind: "", transaction_status: "",
    transaction_gateway: "", transaction_amount: "", transaction_currency: "",
    transaction_processed_at: "", transaction_payment_id: "",
    transaction_account_number: "", transaction_error_code: "",
    transaction_test: "", transaction_parent_id: "",
    // Transaction payment details (Protected Customer Data — redacted on export)
    transaction_payment_method: "", transaction_wallet: "", transaction_message: "",
    transaction_cc_avs_result: "", transaction_cc_bin: "", transaction_cc_cvv_result: "",
    transaction_cc_number: "", transaction_cc_company: "",
    transaction_device_id: "", transaction_user_id: "",
    // Refund (blank unless this is a Refund row)
    refund_id: "", refund_created_at: "", refund_note: "", refund_amount: "",
    refund_currency: "", refund_restock_type: "", refund_restock_location: "",
    refund_send_receipt: "", refund_generate_transaction: "", // import directives
    // Fulfillment (blank unless this is a Fulfillment row)
    fulfillment_id: "", fulfillment_display_status: "",
    fulfillment_created_at: "", fulfillment_updated_at: "",
    fulfillment_total_quantity: "", fulfillment_service: "",
    fulfillment_location: "", fulfillment_shipment_status: "",
    fulfillment_send_receipt: "", // import directive
    fulfillment_tracking_company: "", fulfillment_tracking_number: "",
    fulfillment_tracking_url: "",

    // Numbered tax lines (order-level + this line item's)
    ...taxLineCols(order.taxLines, "tax", ORDER_TAX_CAP),
    ...taxLineCols(lineItem?.taxLines, "line_tax", ORDER_TAX_CAP),
  };
}

// ── Order sub-entity field builders (for multi-row export) ──────────────────
function orderTransactionFields(t) {
  return {
    transaction_id:         gid(t.id),
    transaction_kind:       t.kind ?? "",
    transaction_status:     t.status ?? "",
    transaction_gateway:    t.gateway ?? "",
    transaction_amount:     t.amountSet?.shopMoney?.amount ?? "",
    transaction_currency:   t.amountSet?.shopMoney?.currencyCode ?? "",
    transaction_processed_at: t.processedAt ?? "",
    transaction_payment_id: t.paymentId ?? "",
    transaction_account_number: t.accountNumber ?? "",
    transaction_error_code: t.errorCode ?? "",
    transaction_test:       t.test ?? "",
    transaction_parent_id:  t.parentTransaction ? gid(t.parentTransaction.id) : "",
  };
}
function orderRefundFields(r) {
  const rli = (r.refundLineItems?.nodes ?? [])[0] ?? {};
  return {
    refund_id:         gid(r.id),
    refund_created_at: r.createdAt ?? "",
    refund_note:       r.note ?? "",
    refund_amount:     r.totalRefundedSet?.shopMoney?.amount ?? "",
    refund_currency:   r.totalRefundedSet?.shopMoney?.currencyCode ?? "",
    refund_restock_type:     rli.restockType ?? "",
    refund_restock_location: rli.location?.name ?? "",
  };
}
function orderFulfillmentFields(f) {
  const tr = (f.trackingInfo ?? [])[0] ?? {};
  return {
    fulfillment_id:           gid(f.id),
    fulfillment_display_status: f.displayStatus ?? f.status ?? "",
    fulfillment_created_at:   f.createdAt ?? "",
    fulfillment_updated_at:   f.updatedAt ?? "",
    fulfillment_total_quantity: f.totalQuantity ?? "",
    fulfillment_service:      f.service?.handle ?? "",
    fulfillment_location:     f.location?.name ?? "",
    fulfillment_tracking_company: tr.company ?? "",
    fulfillment_tracking_number:  tr.number ?? "",
    fulfillment_tracking_url:     tr.url ?? "",
  };
}

/**
 * Build all export rows for one order (Matrixify-style multi-row): one row per
 * line item, then one row per transaction, refund, and fulfillment — each
 * tagged via the `line_type` column. The first line-item row is the "top row"
 * carrying the full order data; every row shares the same column set.
 * Works on the direct path (sub-entities inline) and the bulk path (only line
 * items present → just Line Item rows).
 *
 * @param {object} order - order node; order.lineItems.nodes + inline lists
 * @returns {object[]} flat rows
 */
export function buildOrderRows(order) {
  const rows = [];
  let rn = 1;

  const lineItems = order.lineItems?.nodes ?? [];
  const liList = lineItems.length ? lineItems : [null];
  liList.forEach((li, i) => {
    rows.push({
      ...normalizeOrder(order, li),
      line_type: "Line Item",
      top_row:   i === 0 ? "true" : "",
      row_number: rn++,
    });
  });

  // Sub-entities may be a list (direct) or absent (bulk).
  const txns = order.transactions?.nodes ?? order.transactions ?? [];
  for (const t of txns) {
    rows.push({ ...normalizeOrder(order, null), ...orderTransactionFields(t), line_type: "Transaction", row_number: rn++ });
  }
  const refunds = order.refunds?.nodes ?? order.refunds ?? [];
  for (const r of refunds) {
    rows.push({ ...normalizeOrder(order, null), ...orderRefundFields(r), line_type: "Refund", row_number: rn++ });
  }
  const fulfillments = order.fulfillments?.nodes ?? order.fulfillments ?? [];
  for (const f of fulfillments) {
    rows.push({ ...normalizeOrder(order, null), ...orderFulfillmentFields(f), line_type: "Fulfillment", row_number: rn++ });
  }

  return rows;
}

/**
 * Normalize a Shopify customer into a flat export row.
 * One row per customer; the default address is flattened inline.
 *
 * @param {object} customer - raw customer node from GraphQL
 * @returns {object} flat row
 */
export function normalizeCustomer(customer) {
  const addr = customer.defaultAddress ?? {};
  const em = customer.defaultEmailAddress ?? {};
  const ph = customer.defaultPhoneNumber ?? {};
  const money = (set) => set?.shopMoney?.amount ?? "";
  const firstOrder = customer.firstOrder?.nodes?.[0];
  const lastOrder  = customer.lastOrder?.nodes?.[0];
  const credit = customer.storeCreditAccounts?.nodes?.[0]?.balance;

  return {
    // Basic
    customer_id:       gid(customer.id),
    email:             em.emailAddress ?? "",
    command:           "", // import directive
    first_name:        customer.firstName ?? "",
    last_name:         customer.lastName ?? "",
    phone:             ph.phoneNumber ?? "",
    locale:            customer.locale ?? "",
    state:             customer.state ?? "",
    email_marketing_state:      em.marketingState ?? "",
    email_marketing_opt_in:     em.marketingOptInLevel ?? "",
    email_marketing_updated_at: em.marketingUpdatedAt ?? "",
    sms_marketing_state:        ph.marketingState ?? "",
    sms_marketing_opt_in:       ph.marketingOptInLevel ?? "",
    sms_marketing_updated_at:   ph.marketingUpdatedAt ?? "",
    sms_marketing_source:       ph.marketingCollectedFrom ?? "",
    created_at:        customer.createdAt ?? "",
    updated_at:        customer.updatedAt ?? "",
    note:              customer.note ?? "",
    verified_email:    customer.verifiedEmail ?? "",
    tax_exempt:        customer.taxExempt ?? "",
    tax_exemptions:    (customer.taxExemptions ?? []).join(", "),
    data_sale_opt_out: customer.dataSaleOptOut ?? "",
    lifetime_duration: customer.lifetimeDuration ?? "",
    product_subscriber_status: customer.productSubscriberStatus ?? "",
    tags:              (customer.tags ?? []).join(", "),
    tags_command:      "", // import directive
    total_spent:       customer.amountSpent?.amount ?? "",
    orders_count:      customer.numberOfOrders ?? "",
    send_account_activation_email: "", // import directive
    send_welcome_email: "",            // import directive
    password:          "",             // import directive
    multipass_identifier: customer.multipassIdentifier ?? "",

    // First & last order
    first_order_id:           firstOrder ? gid(firstOrder.id) : "",
    first_order_name:         firstOrder?.name ?? "",
    first_order_processed_at: firstOrder?.processedAt ?? "",
    first_order_total:        money(firstOrder?.totalPriceSet),
    last_order_id:            lastOrder ? gid(lastOrder.id) : "",
    last_order_name:          lastOrder?.name ?? "",
    last_order_processed_at:  lastOrder?.processedAt ?? "",
    last_order_total:         money(lastOrder?.totalPriceSet),

    // Default address
    address_row_number: "", // multi-row construct (import)
    address_top_row:    "", // multi-row construct (import)
    address_id:         addr.id ? gid(addr.id) : "",
    address_command:    "", // import directive
    address_first_name: addr.firstName ?? "",
    address_last_name:  addr.lastName ?? "",
    address_company:    addr.company ?? "",
    address_phone:      addr.phone ?? "",
    address1:           addr.address1 ?? "",
    address2:           addr.address2 ?? "",
    address_city:       addr.city ?? "",
    address_province:   addr.province ?? "",
    address_province_code: addr.provinceCode ?? "",
    address_country:    addr.country ?? "",
    address_country_code: addr.countryCodeV2 ?? "",
    address_zip:        addr.zip ?? "",
    address_is_default: customer.defaultAddress ? "true" : "",

    // Activation
    account_activation_url: "", // export-only; not fetched

    // Store credit
    store_credit_currency: credit?.currencyCode ?? "",
    store_credit_balance:  credit?.amount ?? "",

    // Store credit transactions (multi-row sub-entity; blank in this row model)
    store_credit_txn_id:                "",
    store_credit_txn_command:           "",
    store_credit_txn_amount:            "",
    store_credit_txn_expire_at:         "",
    store_credit_txn_send_receipt:      "",
    store_credit_txn_created_at:         "",
    store_credit_txn_event:             "",
    store_credit_txn_remaining_balance: "",
  };
}

/**
 * Normalize a Shopify collection into a flat export row.
 * Smart-collection rules are serialized into a single string so the
 * flat shape stays one row per collection.
 *
 * @param {object} collection - raw collection node from GraphQL
 * @returns {object} flat row
 */
export function normalizeCollection(collection) {
  const ruleSet = collection.ruleSet;
  const rules = (ruleSet?.rules ?? [])
    .map((r) => `${r.column} ${r.relation} ${r.condition}`)
    .join(" | ");

  return {
    collection_id:    gid(collection.id),
    title:            collection.title ?? "",
    handle:           collection.handle ?? "",
    description:      stripHtml(collection.descriptionHtml ?? ""),
    body_html:        collection.descriptionHtml ?? "",
    collection_type:  ruleSet ? "smart" : "custom",
    sort_order:       collection.sortOrder ?? "",
    template_suffix:  collection.templateSuffix ?? "",
    products_count:   collection.productsCount?.count ?? "",
    updated_at:       collection.updatedAt ?? "",
    image_url:        collection.image?.url ?? "",
    image_alt:        collection.image?.altText ?? "",
    image_width:      collection.image?.width ?? "",
    image_height:     collection.image?.height ?? "",
    seo_title:        collection.seo?.title ?? "",
    seo_description:  collection.seo?.description ?? "",
    rules_match:      ruleSet ? (ruleSet.appliedDisjunctively ? "any" : "all") : "",
    rules:            rules,
  };
}

/**
 * Normalize a Shopify discount node into a flat export row.
 * The `discount` field is a union of code/automatic discount types;
 * we read the fields common across them via the resolved node.
 *
 * @param {object} node - raw discountNode from GraphQL
 * @returns {object} flat row
 */
export function normalizeDiscount(node) {
  const d = node.discount ?? {};
  const typename = d.__typename ?? "";
  const isCode = typename.startsWith("DiscountCode");

  const codes = (d.codes?.nodes ?? []).map((c) => c.code).join(", ");

  // customerGets.value is itself a union (percentage vs fixed amount)
  const value = d.customerGets?.value ?? {};
  let valueType = "";
  let valueAmount = "";
  if (value.__typename === "DiscountPercentage") {
    valueType = "percentage";
    valueAmount = value.percentage ?? "";
  } else if (value.__typename === "DiscountAmount") {
    valueType = "fixed_amount";
    valueAmount = value.amount?.amount ?? "";
  } else if (typename.includes("FreeShipping")) {
    valueType = "free_shipping";
  }

  // minimumRequirement is a union (none / quantity / subtotal)
  const min = d.minimumRequirement ?? {};
  const minSubtotal = min.__typename === "DiscountMinimumSubtotal"
    ? min.greaterThanOrEqualToSubtotal?.amount ?? "" : "";
  const minQuantity = min.__typename === "DiscountMinimumQuantity"
    ? min.greaterThanOrEqualToQuantity ?? "" : "";

  const cw = d.combinesWith ?? {};

  return {
    discount_id:    gid(node.id),
    title:          d.title ?? "",
    summary:        d.summary ?? "",
    type:           typename,
    method:         isCode ? "code" : "automatic",
    codes:          codes,
    value_type:     valueType,
    value:          valueAmount,
    status:         d.status ?? "",
    starts_at:      d.startsAt ?? "",
    ends_at:        d.endsAt ?? "",
    created_at:     d.createdAt ?? "",
    updated_at:     d.updatedAt ?? "",
    usage_limit:    d.usageLimit ?? "",
    once_per_customer: d.appliesOncePerCustomer ?? "",
    usage_count:    d.asyncUsageCount ?? "",
    minimum_subtotal: minSubtotal,
    minimum_quantity: minQuantity,
    combines_with_order:    cw.orderDiscounts ?? "",
    combines_with_product:  cw.productDiscounts ?? "",
    combines_with_shipping: cw.shippingDiscounts ?? "",
  };
}

/**
 * Normalize a Shopify Online Store page into a flat export row.
 *
 * @param {object} page - raw page node from GraphQL
 * @returns {object} flat row
 */
export function normalizePage(page) {
  return {
    page_id:         gid(page.id),
    title:           page.title ?? "",
    handle:          page.handle ?? "",
    body_html:       page.body ?? "",
    body_summary:    page.bodySummary ?? "",
    published:       page.isPublished ?? "",
    published_at:    page.publishedAt ?? "",
    template_suffix: page.templateSuffix ?? "",
    created_at:      page.createdAt ?? "",
    updated_at:      page.updatedAt ?? "",
  };
}

/**
 * Normalize a Shopify blog into a flat export row.
 *
 * @param {object} blog - raw blog node from GraphQL
 * @returns {object} flat row
 */
export function normalizeBlog(blog) {
  return {
    blog_id:         gid(blog.id),
    title:           blog.title ?? "",
    handle:          blog.handle ?? "",
    template_suffix: blog.templateSuffix ?? "",
    comment_policy:  blog.commentPolicy ?? "",
    created_at:      blog.createdAt ?? "",
    updated_at:      blog.updatedAt ?? "",
  };
}

/**
 * Normalize a Shopify blog article into a flat export row.
 * Each article carries its parent blog's handle so it can be
 * re-associated on import.
 *
 * @param {object} article - raw article node from GraphQL
 * @returns {object} flat row
 */
export function normalizeArticle(article) {
  return {
    article_id:      gid(article.id),
    blog_id:         article.blog ? gid(article.blog.id) : "",
    blog_handle:     article.blog?.handle ?? "",
    blog_title:      article.blog?.title ?? "",
    title:           article.title ?? "",
    handle:          article.handle ?? "",
    author:          article.author?.name ?? "",
    body_html:       article.body ?? "",
    summary:         article.summary ?? "",
    tags:            (article.tags ?? []).join(", "),
    image_url:       article.image?.url ?? "",
    image_alt:       article.image?.altText ?? "",
    published:       article.isPublished ?? "",
    published_at:    article.publishedAt ?? "",
    template_suffix: article.templateSuffix ?? "",
    created_at:      article.createdAt ?? "",
    updated_at:      article.updatedAt ?? "",
  };
}

/**
 * Normalize a Shopify URL redirect into a flat export row.
 * `command` is an import directive (blank on export), kept for round-trips.
 *
 * @param {object} redirect - raw urlRedirect node from GraphQL
 * @returns {object} flat row
 */
export function normalizeRedirect(redirect) {
  return {
    redirect_id: gid(redirect.id),
    command:     "",
    path:        redirect.path ?? "",
    target:      redirect.target ?? "",
  };
}

/**
 * Normalize a Shopify file (MediaImage / GenericFile / Video) into a flat
 * export row. The source URL, mime type, and size live on different fields
 * per type, so they're resolved by __typename.
 *
 * @param {object} file - raw file node from GraphQL
 * @returns {object} flat row
 */
export function normalizeFile(file) {
  const t = file.__typename ?? "";
  let url = "", mime = "", size = "", width = "", height = "", duration = "";

  if (t === "MediaImage") {
    mime = file.mimeType ?? "";
    size = file.originalSource?.fileSize ?? "";
    url = file.image?.url ?? "";
    width = file.image?.width ?? "";
    height = file.image?.height ?? "";
  } else if (t === "GenericFile") {
    mime = file.mimeType ?? "";
    size = file.originalFileSize ?? "";
    url = file.url ?? "";
  } else if (t === "Video") {
    duration = file.duration ?? "";
    const src = file.originalSource?.[0] ?? {}; // Video.originalSource is a list
    url = src.url ?? "";
    mime = src.mimeType ?? "";
    size = src.fileSize ?? "";
    width = src.width ?? "";
    height = src.height ?? "";
  }

  return {
    file_id:       gid(file.id),
    type:          t,
    alt:           file.alt ?? "",
    status:        file.fileStatus ?? "",
    url:           url,
    mime_type:     mime,
    original_size: size,
    width:         width,
    height:        height,
    duration:      duration,
    created_at:    file.createdAt ?? "",
    updated_at:    file.updatedAt ?? "",
  };
}

/**
 * Normalize a draft order + one of its line items into a flat export row
 * (one row per line item; blank line fields when the draft has none).
 *
 * @param {object} draft - raw draftOrder node from GraphQL
 * @param {object|null} lineItem - one DraftOrderLineItem, or null
 * @returns {object} flat row
 */
export function normalizeDraftOrder(draft, lineItem) {
  const money = (set) => set?.shopMoney?.amount ?? "";
  const cust = draft.customer;
  const properties = (lineItem?.customAttributes ?? [])
    .map((a) => `${a.key}: ${a.value}`)
    .join("; ");

  return {
    draft_order_id:     gid(draft.id),
    name:               draft.name ?? "",
    status:             draft.status ?? "",
    email:              draft.email ?? "",
    phone:              draft.phone ?? "",
    note:               draft.note2 ?? "",
    tags:               (draft.tags ?? []).join(", "),
    currency:           draft.currencyCode ?? "",
    taxes_included:     draft.taxesIncluded ?? "",
    tax_exempt:         draft.taxExempt ?? "",
    invoice_url:        draft.invoiceUrl ?? "",
    created_at:         draft.createdAt ?? "",
    updated_at:         draft.updatedAt ?? "",
    completed_at:       draft.completedAt ?? "",

    total_price:        money(draft.totalPriceSet),
    subtotal_price:     money(draft.subtotalPriceSet),
    total_tax:          money(draft.totalTaxSet),
    total_shipping:     money(draft.totalShippingPriceSet),
    total_discounts:    money(draft.totalDiscountsSet),

    customer_id:         gid(cust?.id),
    customer_email:      cust?.defaultEmailAddress?.emailAddress ?? "",
    customer_first_name: cust?.firstName ?? "",
    customer_last_name:  cust?.lastName ?? "",

    billing_first_name: draft.billingAddress?.firstName ?? "",
    billing_last_name:  draft.billingAddress?.lastName ?? "",
    billing_name:       draft.billingAddress?.name ?? "",
    billing_company:    draft.billingAddress?.company ?? "",
    billing_phone:      draft.billingAddress?.phone ?? "",
    billing_address1:   draft.billingAddress?.address1 ?? "",
    billing_address2:   draft.billingAddress?.address2 ?? "",
    billing_city:       draft.billingAddress?.city ?? "",
    billing_province:   draft.billingAddress?.province ?? "",
    billing_province_code: draft.billingAddress?.provinceCode ?? "",
    billing_zip:        draft.billingAddress?.zip ?? "",
    billing_country:    draft.billingAddress?.country ?? "",
    billing_country_code: draft.billingAddress?.countryCodeV2 ?? "",

    shipping_first_name: draft.shippingAddress?.firstName ?? "",
    shipping_last_name:  draft.shippingAddress?.lastName ?? "",
    shipping_name:       draft.shippingAddress?.name ?? "",
    shipping_company:    draft.shippingAddress?.company ?? "",
    shipping_phone:      draft.shippingAddress?.phone ?? "",
    shipping_address1:   draft.shippingAddress?.address1 ?? "",
    shipping_address2:   draft.shippingAddress?.address2 ?? "",
    shipping_city:       draft.shippingAddress?.city ?? "",
    shipping_province:   draft.shippingAddress?.province ?? "",
    shipping_province_code: draft.shippingAddress?.provinceCode ?? "",
    shipping_zip:        draft.shippingAddress?.zip ?? "",
    shipping_country:    draft.shippingAddress?.country ?? "",
    shipping_country_code: draft.shippingAddress?.countryCodeV2 ?? "",
    shipping_line_title: draft.shippingLine?.title ?? "",
    shipping_line_price: money(draft.shippingLine?.originalPriceSet),

    line_item_id:              lineItem ? gid(lineItem.id) : "",
    line_item_title:           lineItem?.title ?? "",
    line_item_name:            lineItem?.name ?? "",
    line_item_variant_title:   lineItem?.variantTitle ?? "",
    line_item_sku:             lineItem?.sku ?? "",
    line_item_vendor:          lineItem?.vendor ?? "",
    line_item_quantity:        lineItem?.quantity ?? "",
    line_item_price:           money(lineItem?.originalUnitPriceSet),
    line_item_discounted_price: money(lineItem?.approximateDiscountedUnitPriceSet),
    line_item_taxable:         lineItem?.taxable ?? "",
    line_item_requires_shipping: lineItem?.requiresShipping ?? "",
    line_item_gift_card:       lineItem?.isGiftCard ?? "",
    line_item_properties:      properties,
    line_item_product_id:      lineItem?.product ? gid(lineItem.product.id) : "",
    line_item_variant_id:      lineItem?.variant ? gid(lineItem.variant.id) : "",
  };
}

/**
 * Flatten a B2B company into one row per location, each carrying the
 * company-level fields. A company with no locations yields a single row with
 * blank location/address fields. Works on both the direct query (locations
 * inline) and the bulk path (locations rebuilt from child lines).
 *
 * @param {object} company - raw company node with company.locations.nodes
 * @returns {object[]} flat rows
 */
export function buildCompanyRows(company) {
  const c = company;
  const base = {
    company_id:          gid(c.id),
    company_name:        c.name ?? "",
    company_external_id: c.externalId ?? "",
    company_note:        c.note ?? "",
    contacts_count:      c.contactsCount?.count ?? "",
    orders_count:        c.ordersCount?.count ?? "",
    total_spent:         c.totalSpent?.amount ?? "",
    currency:            c.totalSpent?.currencyCode ?? "",
    main_contact_id:     c.mainContact?.customer ? gid(c.mainContact.customer.id) : "",
    main_contact_name:   c.mainContact?.customer?.displayName ?? "",
    main_contact_email:  c.mainContact?.customer?.defaultEmailAddress?.emailAddress ?? "",
    created_at:          c.createdAt ?? "",
    updated_at:          c.updatedAt ?? "",
  };

  const addr = (a, prefix) => {
    a = a ?? {};
    return {
      [`${prefix}_address1`]:     a.address1 ?? "",
      [`${prefix}_address2`]:     a.address2 ?? "",
      [`${prefix}_city`]:         a.city ?? "",
      [`${prefix}_province`]:     a.province ?? "",
      [`${prefix}_zip`]:          a.zip ?? "",
      [`${prefix}_country`]:      a.country ?? "",
      [`${prefix}_country_code`]: a.countryCode ?? "",
      [`${prefix}_recipient`]:    a.recipient ?? "",
      [`${prefix}_phone`]:        a.phone ?? "",
    };
  };
  const blankLoc = {
    location_id: "", location_name: "", location_external_id: "",
    location_phone: "", location_note: "",
    ...addr(null, "billing"), ...addr(null, "shipping"),
  };

  const locations = c.locations?.nodes ?? [];
  if (locations.length === 0) return [{ ...base, ...blankLoc }];

  return locations.map((loc) => ({
    ...base,
    location_id:          gid(loc.id),
    location_name:        loc.name ?? "",
    location_external_id: loc.externalId ?? "",
    location_phone:       loc.phone ?? "",
    location_note:        loc.note ?? "",
    ...addr(loc.billingAddress, "billing"),
    ...addr(loc.shippingAddress, "shipping"),
  }));
}

/**
 * Flatten a navigation menu into one row per (recursively nested) menu item,
 * each carrying the parent menu's fields and the item's 1-based nesting level.
 * A menu with no items yields a single row with blank item fields.
 *
 * @param {object} menu - raw menu node from GraphQL (items nested up to 3 deep)
 * @returns {object[]} flat rows
 */
export function buildMenuRows(menu) {
  const base = {
    menu_id:         gid(menu.id),
    menu_handle:     menu.handle ?? "",
    menu_title:      menu.title ?? "",
    menu_is_default: menu.isDefault ?? "",
  };
  const blankItem = {
    item_id: "", item_title: "", item_type: "", item_url: "",
    item_resource_id: "", item_tags: "", item_level: "",
  };

  const rows = [];
  const walk = (items, level) => {
    for (const it of items ?? []) {
      rows.push({
        ...base,
        item_id:          gid(it.id),
        item_title:       it.title ?? "",
        item_type:        it.type ?? "",
        item_url:         it.url ?? "",
        item_resource_id: it.resourceId ? gid(it.resourceId) : "",
        item_tags:        (it.tags ?? []).join(", "),
        item_level:       level,
      });
      if (it.items?.length) walk(it.items, level + 1);
    }
  };

  if (!menu.items?.length) rows.push({ ...base, ...blankItem });
  else walk(menu.items, 1);

  return rows;
}

/**
 * Normalize a store location into a flat export row.
 *
 * @param {object} loc - raw location node from GraphQL
 * @returns {object} flat row
 */
export function normalizeLocation(loc) {
  const a = loc.address ?? {};
  return {
    location_id:           gid(loc.id),
    name:                  loc.name ?? "",
    active:                loc.isActive ?? "",
    fulfills_online_orders: loc.fulfillsOnlineOrders ?? "",
    ships_inventory:       loc.shipsInventory ?? "",
    address1:              a.address1 ?? "",
    address2:              a.address2 ?? "",
    address_city:          a.city ?? "",
    address_province:      a.province ?? "",
    address_province_code: a.provinceCode ?? "",
    address_zip:           a.zip ?? "",
    address_country:       a.country ?? "",
    address_country_code:  a.countryCode ?? "",
    address_phone:         a.phone ?? "",
  };
}

/**
 * Normalize a catalog (Market / B2B / App) into a flat export row.
 *
 * @param {object} cat - raw catalog node from GraphQL
 * @returns {object} flat row
 */
export function normalizeCatalog(cat) {
  return {
    catalog_id:      gid(cat.id),
    title:           cat.title ?? "",
    type:            cat.__typename ?? "",
    status:          cat.status ?? "",
    price_list_id:   cat.priceList ? gid(cat.priceList.id) : "",
    price_list_name: cat.priceList?.name ?? "",
    publication_id:  cat.publication ? gid(cat.publication.id) : "",
  };
}

/**
 * Normalize a Shopify Payments payout into a flat export row.
 *
 * @param {object} payout - raw payout node from GraphQL
 * @returns {object} flat row
 */
export function normalizePayout(payout) {
  const m = (v) => v?.amount ?? "";
  const s = payout.summary ?? {};
  return {
    payout_id:            payout.legacyResourceId ?? gid(payout.id),
    status:               payout.status ?? "",
    issued_at:            payout.issuedAt ?? "",
    amount:               m(payout.net),
    currency:             payout.net?.currencyCode ?? "",
    charges_gross:        m(s.chargesGross),
    charges_fee:          m(s.chargesFee),
    refunds_gross:        m(s.refundsFeeGross),
    refunds_fee:          m(s.refundsFee),
    adjustments_gross:    m(s.adjustmentsGross),
    adjustments_fee:      m(s.adjustmentsFee),
    reserved_funds_gross: m(s.reservedFundsGross),
    reserved_funds_fee:   m(s.reservedFundsFee),
    retried_payouts_gross: m(s.retriedPayoutsGross),
    retried_payouts_fee:  m(s.retriedPayoutsFee),
  };
}

/**
 * Normalize the Shop singleton into a flat export row (one row total).
 *
 * @param {object} shop - raw shop node from GraphQL
 * @returns {object} flat row
 */
export function normalizeShop(shop) {
  const a = shop.shopAddress ?? {};
  const p = shop.plan ?? {};
  return {
    shop_id:          gid(shop.id),
    name:             shop.name ?? "",
    email:            shop.email ?? "",
    contact_email:    shop.contactEmail ?? "",
    domain:           shop.myshopifyDomain ?? "",
    primary_domain:   shop.primaryDomain?.host ?? "",
    url:              shop.url ?? "",
    currency:         shop.currencyCode ?? "",
    timezone:         shop.ianaTimezone ?? "",
    weight_unit:      shop.weightUnit ?? "",
    plan_name:        p.publicDisplayName ?? "",
    plan_plus:        p.shopifyPlus ?? "",
    plan_partner_dev: p.partnerDevelopment ?? "",
    address1:         a.address1 ?? "",
    address2:         a.address2 ?? "",
    address_city:     a.city ?? "",
    address_province: a.province ?? "",
    address_province_code: a.provinceCode ?? "",
    address_zip:      a.zip ?? "",
    address_country:  a.country ?? "",
    address_country_code: a.countryCodeV2 ?? "",
    address_phone:    a.phone ?? "",
    created_at:       shop.createdAt ?? "",
    updated_at:       shop.updatedAt ?? "",
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Convert a Shopify Weight ({ value, unit }) to grams. */
function gramsFrom(w) {
  if (!w || w.value == null) return "";
  const v = Number(w.value);
  switch (w.unit) {
    case "KILOGRAMS": return v * 1000;
    case "POUNDS":    return Math.round(v * 453.592);
    case "OUNCES":    return Math.round(v * 28.3495);
    default:          return v; // GRAMS (or unknown)
  }
}

/** Strip "gid://shopify/Product/12345" down to "12345" */
function gid(globalId) {
  if (!globalId) return "";
  return globalId.split("/").pop();
}

/** Very lightweight HTML stripper for description fields */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}