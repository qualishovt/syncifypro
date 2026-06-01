/**
 * export/fieldLists.js
 *
 * Canonical column order per entity — the single source of truth for the
 * shape users see (and re-import). The export UI uses these for the
 * column-selection checkboxes; the streaming bulk worker uses them to
 * write the header before it has seen any rows. Keep each list in sync
 * with the matching normalize* function in normalizer.js.
 */

export const PRODUCT_FIELDS = [
  "product_id", "title", "handle", "status", "vendor", "product_type",
  "tags", "description", "image_url", "variant_id", "variant_title",
  "sku", "price", "compare_at_price", "inventory_qty", "barcode",
  "weight", "weight_unit", "taxable", "created_at", "updated_at",
];

export const ORDER_FIELDS = [
  "order_id", "order_name", "email", "phone", "financial_status",
  "fulfillment_status", "currency", "total_price", "subtotal_price",
  "total_tax", "total_shipping", "total_discounts", "note", "tags",
  "cancel_reason", "cancelled_at", "processed_at", "created_at", "updated_at",
  "customer_id", "customer_email", "customer_first_name", "customer_last_name",
  "billing_first_name", "billing_last_name", "billing_company",
  "billing_address1", "billing_address2", "billing_city", "billing_province",
  "billing_zip", "billing_country", "billing_phone",
  "shipping_first_name", "shipping_last_name", "shipping_company",
  "shipping_address1", "shipping_address2", "shipping_city", "shipping_province",
  "shipping_zip", "shipping_country", "shipping_phone",
  "line_item_id", "line_item_title", "line_item_variant_title",
  "line_item_sku", "line_item_vendor", "line_item_quantity",
  "line_item_price", "line_item_discounted_price", "line_item_total_discount",
  "line_item_taxable", "line_item_requires_shipping",
  "line_item_fulfillment_status", "line_item_product_id", "line_item_variant_id",
];

export const CUSTOMER_FIELDS = [
  "customer_id", "first_name", "last_name", "email", "phone",
  "verified_email", "state", "tags", "note", "orders_count",
  "total_spent", "total_spent_currency", "email_marketing_state",
  "email_marketing_opt_in", "address_company", "address1", "address2",
  "address_city", "address_province", "address_province_code", "address_zip",
  "address_country", "address_country_code", "address_phone",
  "created_at", "updated_at",
];

export const COLLECTION_FIELDS = [
  "collection_id", "title", "handle", "description", "collection_type",
  "sort_order", "template_suffix", "products_count", "image_url",
  "seo_title", "seo_description", "rules_match", "rules", "updated_at",
];

export const DISCOUNT_FIELDS = [
  "discount_id", "title", "type", "method", "codes", "value_type", "value",
  "status", "starts_at", "ends_at", "usage_limit", "once_per_customer",
  "usage_count",
];

export const PAGE_FIELDS = [
  "page_id", "title", "handle", "body_html", "body_summary", "published",
  "published_at", "template_suffix", "created_at", "updated_at",
];

export const BLOG_FIELDS = [
  "blog_id", "title", "handle", "template_suffix", "comment_policy",
  "created_at", "updated_at",
];

export const ARTICLE_FIELDS = [
  "article_id", "blog_id", "blog_handle", "blog_title", "title", "handle",
  "author", "body_html", "summary", "tags", "image_url", "published",
  "published_at", "template_suffix", "created_at", "updated_at",
];

export const FIELDS_BY_ENTITY = {
  products:    PRODUCT_FIELDS,
  orders:      ORDER_FIELDS,
  customers:   CUSTOMER_FIELDS,
  collections: COLLECTION_FIELDS,
  discounts:   DISCOUNT_FIELDS,
  pages:       PAGE_FIELDS,
  blogs:       BLOG_FIELDS,
  articles:    ARTICLE_FIELDS,
};
