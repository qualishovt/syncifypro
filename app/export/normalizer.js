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

/**
 * Normalize a Shopify customer into a flat export row.
 * One row per customer; the default address is flattened inline.
 *
 * @param {object} customer - raw customer node from GraphQL
 * @returns {object} flat row
 */
export function normalizeCustomer(customer) {
  const addr = customer.defaultAddress ?? {};

  return {
    customer_id:       gid(customer.id),
    first_name:        customer.firstName ?? "",
    last_name:         customer.lastName ?? "",
    email:             customer.defaultEmailAddress?.emailAddress ?? "",
    phone:             customer.defaultPhoneNumber?.phoneNumber ?? "",
    verified_email:    customer.verifiedEmail ?? "",
    state:             customer.state ?? "",
    tags:              (customer.tags ?? []).join(", "),
    note:              customer.note ?? "",
    orders_count:      customer.numberOfOrders ?? "",
    total_spent:       customer.amountSpent?.amount ?? "",
    total_spent_currency: customer.amountSpent?.currencyCode ?? "",
    email_marketing_state:     customer.defaultEmailAddress?.marketingState ?? "",
    email_marketing_opt_in:    customer.defaultEmailAddress?.marketingOptInLevel ?? "",
    address_company:   addr.company ?? "",
    address1:          addr.address1 ?? "",
    address2:          addr.address2 ?? "",
    address_city:      addr.city ?? "",
    address_province:  addr.province ?? "",
    address_province_code: addr.provinceCode ?? "",
    address_zip:       addr.zip ?? "",
    address_country:   addr.country ?? "",
    address_country_code:  addr.countryCodeV2 ?? "",
    address_phone:     addr.phone ?? "",
    created_at:        customer.createdAt ?? "",
    updated_at:        customer.updatedAt ?? "",
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
    collection_type:  ruleSet ? "smart" : "custom",
    sort_order:       collection.sortOrder ?? "",
    template_suffix:  collection.templateSuffix ?? "",
    products_count:   collection.productsCount?.count ?? "",
    image_url:        collection.image?.url ?? "",
    seo_title:        collection.seo?.title ?? "",
    seo_description:  collection.seo?.description ?? "",
    rules_match:      ruleSet ? (ruleSet.appliedDisjunctively ? "any" : "all") : "",
    rules:            rules,
    updated_at:       collection.updatedAt ?? "",
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

  return {
    discount_id:    gid(node.id),
    title:          d.title ?? "",
    type:           typename,
    method:         isCode ? "code" : "automatic",
    codes:          codes,
    value_type:     valueType,
    value:          valueAmount,
    status:         d.status ?? "",
    starts_at:      d.startsAt ?? "",
    ends_at:        d.endsAt ?? "",
    usage_limit:    d.usageLimit ?? "",
    once_per_customer: d.appliesOncePerCustomer ?? "",
    usage_count:    d.asyncUsageCount ?? "",
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
    published:       article.isPublished ?? "",
    published_at:    article.publishedAt ?? "",
    template_suffix: article.templateSuffix ?? "",
    created_at:      article.createdAt ?? "",
    updated_at:      article.updatedAt ?? "",
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