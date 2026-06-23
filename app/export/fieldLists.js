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
  // Basic Columns
  "product_id", "handle", "command", "title", "body_html", "vendor",
  "product_type", "tags", "tags_command", "created_at", "updated_at",
  "status", "published", "published_at", "published_scope",
  "template_suffix", "gift_card", "url", "total_inventory_qty",
  "row_number", "top_row",
  // SEO
  "seo_title", "seo_description",
  // Category
  "category_id", "category_name", "category_tree",
  // Collections
  "custom_collections", "smart_collections", "collection",
  // Media
  "image_type", "image_url", "image_command", "image_position",
  "image_width", "image_height", "image_alt", "image_attachment",
  // Inventory / Variants
  "variant_inventory_item_id", "variant_id", "variant_command",
  "variant_generate_from_options",
  "option1_name", "option1_value", "option2_name", "option2_value",
  "option3_name", "option3_value", "variant_position", "sku", "barcode",
  "variant_image", "weight", "weight_unit", "variant_grams", "price",
  "compare_at_price", "taxable", "variant_tax_code", "inventory_tracker",
  "inventory_policy", "variant_fulfillment_service", "requires_shipping",
  "variant_shipping_profile", "inventory_qty", "variant_inventory_adjust",
  "variant_cost",
  // Customs Information
  "variant_country_of_origin",
  "variant_province_of_origin", "variant_hs_code",
  // Google Shopping (Matrixify pre-listed metafields)
  "gs_google_product_category", "gs_custom_product", "gs_gmc_id", "gs_mpn",
  "gs_age_group", "gs_gender", "gs_condition", "gs_color", "gs_material",
  "gs_size", "gs_size_system",
];

// Numbered tax-line columns (capped at 5 sets, matching normalizer ORDER_TAX_CAP).
const taxCols = (prefix, cap) =>
  Array.from({ length: cap }, (_, i) => [
    `${prefix}_${i + 1}_title`, `${prefix}_${i + 1}_rate`,
    `${prefix}_${i + 1}_price`, `${prefix}_${i + 1}_channel_liable`,
  ]).flat();
export const ORDER_TAX_FIELDS = taxCols("tax", 5);
export const LINE_TAX_FIELDS = taxCols("line_tax", 5);

export const ORDER_FIELDS = [
  // Row type
  "line_type", "top_row", "row_number",
  // Order
  "order_id", "order_name", "order_number", "email", "phone", "note", "tags",
  "financial_status", "fulfillment_status", "currency", "presentment_currency",
  "taxes_included", "test", "confirmed", "source_name", "source_identifier",
  "confirmation_number", "send_receipt", "inventory_behaviour",
  "cancel_send_receipt", "cancel_refund", "order_status_url",
  "line_items_quantity", "total_weight", "cancel_reason", "cancelled_at",
  "closed_at", "processed_at", "created_at", "updated_at",
  // Totals
  "total_price", "subtotal_price", "total_tax", "total_shipping",
  "total_discounts", "current_total_price", "total_refunded",
  "current_total_duties", "total_duties", "current_total_fees", "total_fees",
  "total_received", "net_payment", "total_capturable", "tax_lines",
  // Order taxes (numbered)
  ...ORDER_TAX_FIELDS,
  // Browser / UTM
  "browser_ip", "landing_page", "referrer_url", "source", "source_type",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  // Company
  "company_id", "company_name", "company_location_id", "company_location_name",
  // Risk
  "risk_recommendation", "risk_level", "risk_facts",
  // Buyer
  "customer_id", "customer_email", "customer_phone", "customer_first_name",
  "customer_last_name", "customer_note", "customer_state",
  "customer_orders_count", "customer_total_spent", "customer_tags",
  "customer_tax_exempt", "customer_email_marketing", "customer_sms_marketing",
  // Billing
  "billing_first_name", "billing_last_name", "billing_name", "billing_company",
  "billing_phone", "billing_address1", "billing_address2", "billing_city",
  "billing_province", "billing_province_code", "billing_zip", "billing_country",
  "billing_country_code",
  // Shipping
  "shipping_first_name", "shipping_last_name", "shipping_name",
  "shipping_company", "shipping_phone", "shipping_address1", "shipping_address2",
  "shipping_city", "shipping_province", "shipping_province_code", "shipping_zip",
  "shipping_country", "shipping_country_code", "shipping_line_title",
  "shipping_line_code", "shipping_line_source", "shipping_line_price",
  "shipping_line_tax",
  // Items
  "line_item_id", "line_item_title", "line_item_name", "line_item_variant_title",
  "line_item_sku", "line_item_vendor", "line_item_quantity",
  "line_item_current_quantity", "line_item_unfulfilled_quantity",
  "line_item_price", "line_item_discounted_price", "line_item_total",
  "line_item_total_discount", "line_item_taxable", "line_item_requires_shipping",
  "line_item_gift_card", "line_item_properties", "line_item_fulfillment_status",
  "line_item_product_id", "line_item_variant_id", "line_item_product_handle",
  // Item Data
  "line_item_product_type", "line_item_product_tags", "line_item_variant_barcode",
  "line_item_variant_weight", "line_item_variant_weight_unit",
  "line_item_variant_inventory_qty", "line_item_variant_cost",
  "line_item_variant_price", "line_item_variant_compare_at_price",
  "line_item_variant_country_of_origin", "line_item_variant_province_of_origin",
  "line_item_variant_hs_code",
  // Line taxes (numbered)
  ...LINE_TAX_FIELDS,
  // Transactions
  "transaction_id", "transaction_kind", "transaction_status", "transaction_gateway",
  "transaction_amount", "transaction_currency", "transaction_processed_at",
  "transaction_payment_id", "transaction_account_number", "transaction_error_code",
  "transaction_test", "transaction_parent_id",
  "transaction_payment_method", "transaction_wallet", "transaction_message",
  "transaction_cc_avs_result", "transaction_cc_bin", "transaction_cc_cvv_result",
  "transaction_cc_number", "transaction_cc_company", "transaction_device_id",
  "transaction_user_id",
  // Refunds
  "refund_id", "refund_created_at", "refund_note", "refund_amount", "refund_currency",
  "refund_restock_type", "refund_restock_location", "refund_send_receipt",
  "refund_generate_transaction",
  // Fulfillments
  "fulfillment_id", "fulfillment_display_status", "fulfillment_created_at",
  "fulfillment_updated_at", "fulfillment_total_quantity", "fulfillment_service",
  "fulfillment_location", "fulfillment_shipment_status", "fulfillment_send_receipt",
  "fulfillment_tracking_company", "fulfillment_tracking_number", "fulfillment_tracking_url",
];

export const CUSTOMER_FIELDS = [
  // Profile (basic)
  "customer_id", "email", "command", "first_name", "last_name", "phone",
  "locale", "state", "email_marketing_state", "email_marketing_opt_in",
  "email_marketing_updated_at", "sms_marketing_state", "sms_marketing_opt_in",
  "sms_marketing_updated_at", "sms_marketing_source", "created_at", "updated_at",
  "note", "verified_email", "tax_exempt", "tags", "tags_command", "total_spent",
  "orders_count", "send_account_activation_email", "send_welcome_email",
  "password", "multipass_identifier",
  // First & last order
  "first_order_id", "first_order_name", "first_order_processed_at", "first_order_total",
  "last_order_id", "last_order_name", "last_order_processed_at", "last_order_total",
  // Address
  "address_row_number", "address_top_row", "address_id", "address_command",
  "address_first_name", "address_last_name", "address_company", "address_phone",
  "address1", "address2", "address_city", "address_province",
  "address_province_code", "address_country", "address_country_code", "address_zip",
  "address_is_default",
  // Activation
  "account_activation_url",
  // Store credit
  "store_credit_currency", "store_credit_balance",
  "store_credit_txn_id", "store_credit_txn_command", "store_credit_txn_amount",
  "store_credit_txn_expire_at", "store_credit_txn_send_receipt",
  "store_credit_txn_created_at", "store_credit_txn_event",
  "store_credit_txn_remaining_balance",
];

export const COLLECTION_FIELDS = [
  // Basics
  "collection_id", "title", "handle", "description", "body_html",
  "collection_type", "sort_order", "template_suffix", "products_count",
  "updated_at",
  // Media
  "image_url", "image_alt", "image_width", "image_height",
  // SEO
  "seo_title", "seo_description",
  // Rules
  "rules_match", "rules",
];

export const DISCOUNT_FIELDS = [
  // Basics
  "discount_id", "title", "summary", "type", "method", "codes",
  "value_type", "value", "status", "starts_at", "ends_at",
  "created_at", "updated_at",
  // Usage
  "usage_limit", "once_per_customer", "usage_count",
  // Requirements
  "minimum_subtotal", "minimum_quantity",
  // Combines With
  "combines_with_order", "combines_with_product", "combines_with_shipping",
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
  "author", "body_html", "summary", "tags", "image_url", "image_alt",
  "published", "published_at", "template_suffix", "created_at", "updated_at",
];

export const REDIRECT_FIELDS = ["redirect_id", "command", "path", "target"];

export const SHOP_FIELDS = [
  // Shop
  "shop_id", "name", "email", "contact_email", "domain", "primary_domain",
  "url", "currency", "timezone", "weight_unit", "plan_name", "plan_plus",
  "plan_partner_dev", "created_at", "updated_at",
  // Address
  "address1", "address2", "address_city", "address_province",
  "address_province_code", "address_zip", "address_country",
  "address_country_code", "address_phone",
];

export const FILE_FIELDS = [
  "file_id", "type", "alt", "status", "url", "mime_type", "original_size",
  "width", "height", "duration", "created_at", "updated_at",
];

export const PAYOUT_FIELDS = [
  // Payout
  "payout_id", "status", "issued_at", "amount", "currency",
  // Summary
  "charges_gross", "charges_fee", "refunds_gross", "refunds_fee",
  "adjustments_gross", "adjustments_fee", "reserved_funds_gross",
  "reserved_funds_fee", "retried_payouts_gross", "retried_payouts_fee",
];

export const MENU_FIELDS = [
  // Menu
  "menu_id", "menu_handle", "menu_title", "menu_is_default",
  // Item
  "item_id", "item_title", "item_type", "item_url", "item_resource_id",
  "item_tags", "item_level",
];

export const COMPANY_FIELDS = [
  // Company
  "company_id", "company_name", "company_external_id", "company_note",
  "contacts_count", "orders_count", "total_spent", "currency",
  "main_contact_id", "main_contact_name", "main_contact_email",
  "created_at", "updated_at",
  // Location
  "location_id", "location_name", "location_external_id", "location_phone",
  "location_note",
  // Billing
  "billing_address1", "billing_address2", "billing_city", "billing_province",
  "billing_zip", "billing_country", "billing_country_code", "billing_recipient",
  "billing_phone",
  // Shipping
  "shipping_address1", "shipping_address2", "shipping_city", "shipping_province",
  "shipping_zip", "shipping_country", "shipping_country_code",
  "shipping_recipient", "shipping_phone",
];

export const DRAFT_ORDER_FIELDS = [
  // Draft
  "draft_order_id", "name", "status", "email", "phone", "note", "tags",
  "currency", "taxes_included", "tax_exempt", "invoice_url",
  "created_at", "updated_at", "completed_at",
  // Totals
  "total_price", "subtotal_price", "total_tax", "total_shipping", "total_discounts",
  // Customer
  "customer_id", "customer_email", "customer_first_name", "customer_last_name",
  // Billing
  "billing_first_name", "billing_last_name", "billing_name", "billing_company",
  "billing_phone", "billing_address1", "billing_address2", "billing_city",
  "billing_province", "billing_province_code", "billing_zip", "billing_country",
  "billing_country_code",
  // Shipping
  "shipping_first_name", "shipping_last_name", "shipping_name", "shipping_company",
  "shipping_phone", "shipping_address1", "shipping_address2", "shipping_city",
  "shipping_province", "shipping_province_code", "shipping_zip", "shipping_country",
  "shipping_country_code", "shipping_line_title", "shipping_line_price",
  // Items
  "line_item_id", "line_item_title", "line_item_name", "line_item_variant_title",
  "line_item_sku", "line_item_vendor", "line_item_quantity", "line_item_price",
  "line_item_discounted_price", "line_item_taxable", "line_item_requires_shipping",
  "line_item_gift_card", "line_item_properties", "line_item_product_id",
  "line_item_variant_id",
];

export const ACTIVITY_FIELDS = [
  "activity_id", "entity", "format", "status", "row_count", "filename",
  "error", "created_at", "completed_at",
];

export const METAOBJECT_FIELDS = [
  "metaobject_id", "handle", "type", "display_name", "fields", "updated_at",
];

export const METAFIELD_DEF_FIELDS = [
  "definition_id", "namespace", "key", "name", "description", "owner_type",
  "type", "validations", "metafields_count",
];

export const TRANSLATION_FIELDS = [
  "translatable_type", "translatable_id", "field", "locale", "source",
  "translated", "outdated",
];

export const LOCATION_FIELDS = [
  "location_id", "name", "active", "fulfills_online_orders", "ships_inventory",
  "address1", "address2", "address_city", "address_province",
  "address_province_code", "address_zip", "address_country",
  "address_country_code", "address_phone",
];

export const CATALOG_FIELDS = [
  "catalog_id", "title", "type", "status", "price_list_id", "price_list_name",
  "publication_id",
];

export const METAOBJECT_DEF_FIELDS = [
  "definition_id", "type", "name", "description", "metaobjects_count",
  "field_definitions",
];

export const INVENTORY_TRANSFER_FIELDS = [
  "transfer_id", "name", "status", "reference_name", "origin_location",
  "destination_location", "date_created",
];

// Merged "Definitions" = metafield defs + metaobject defs (union + `kind`).
export const DEFINITION_FIELDS = [
  "kind", "definition_id", "namespace", "key", "name", "type", "owner_type",
  "description", "validations", "field_definitions", "metafields_count",
  "metaobjects_count",
];

// Merged "Content" = pages + articles (union + `content_type`).
export const CONTENT_FIELDS = [
  "content_type", "id", "title", "handle", "body_html", "summary", "author",
  "tags", "image_url", "image_alt", "blog_id", "blog_handle", "blog_title",
  "published", "published_at", "template_suffix", "created_at", "updated_at",
];

export const FIELDS_BY_ENTITY = {
  products:    PRODUCT_FIELDS,
  orders:      ORDER_FIELDS,
  customers:   CUSTOMER_FIELDS,
  collections: COLLECTION_FIELDS,
  smart_collections:  COLLECTION_FIELDS,
  custom_collections: COLLECTION_FIELDS,
  discounts:   DISCOUNT_FIELDS,
  pages:       PAGE_FIELDS,
  blogs:       BLOG_FIELDS,
  articles:    ARTICLE_FIELDS,
  redirects:   REDIRECT_FIELDS,
  shop:        SHOP_FIELDS,
  files:       FILE_FIELDS,
  payouts:     PAYOUT_FIELDS,
  menus:       MENU_FIELDS,
  companies:   COMPANY_FIELDS,
  draft_orders: DRAFT_ORDER_FIELDS,
  activity:    ACTIVITY_FIELDS,
  metaobjects: METAOBJECT_FIELDS,
  metafields:  METAFIELD_DEF_FIELDS,
  translations: TRANSLATION_FIELDS,
  locations:   LOCATION_FIELDS,
  catalogs:    CATALOG_FIELDS,
  metaobject_definitions: METAOBJECT_DEF_FIELDS,
  inventory_transfers: INVENTORY_TRANSFER_FIELDS,
  definitions: DEFINITION_FIELDS,
  content:     CONTENT_FIELDS,
};

/**
 * Column groups per entity — used by the export UI to show sub-collapsibles
 * (Matrixify-style "Basic / Variant / Image / …"). The union of a group's
 * keys must equal FIELDS_BY_ENTITY[entity].
 */
export const COLUMN_GROUPS_BY_ENTITY = {
  products: [
    { label: "Basics", fields: [
      "product_id", "handle", "command", "title", "body_html", "vendor",
      "product_type", "tags", "tags_command", "created_at", "updated_at",
      "status", "published", "published_at", "published_scope",
      "template_suffix", "gift_card", "url", "total_inventory_qty",
      "row_number", "top_row",
    ] },
    { label: "SEO", fields: ["seo_title", "seo_description"] },
    { label: "Category", fields: ["category_id", "category_name", "category_tree"] },
    { label: "Collections", speed: "Slow", fields: ["custom_collections", "smart_collections", "collection"] },
    { label: "Media", speed: "Slow", fields: [
      "image_type", "image_url", "image_command", "image_position",
      "image_width", "image_height", "image_alt", "image_attachment",
    ] },
    { label: "Variants", fields: [
      "variant_inventory_item_id", "variant_id", "variant_command",
      "variant_generate_from_options",
      "option1_name", "option1_value", "option2_name", "option2_value",
      "option3_name", "option3_value", "variant_position", "sku", "barcode",
      "variant_image", "price", "compare_at_price", "variant_cost", "taxable",
      "variant_tax_code",
    ] },
    { label: "Inventory", fields: [
      "inventory_tracker", "inventory_policy", "inventory_qty",
      "variant_inventory_adjust",
    ] },
    { label: "Shipping", speed: "Slow", fields: [
      "weight", "weight_unit", "variant_grams", "requires_shipping",
      "variant_fulfillment_service", "variant_shipping_profile",
      "variant_country_of_origin", "variant_province_of_origin", "variant_hs_code",
    ] },
    { label: "Google Shopping", fields: [
      "gs_google_product_category", "gs_custom_product", "gs_gmc_id", "gs_mpn",
      "gs_age_group", "gs_gender", "gs_condition", "gs_color", "gs_material",
      "gs_size", "gs_size_system",
    ] },
  ],
  orders: [
    { label: "Row", fields: ["line_type", "top_row", "row_number"] },
    { label: "Order", fields: [
      "order_id", "order_name", "order_number", "email", "phone", "note", "tags",
      "financial_status", "fulfillment_status", "currency", "presentment_currency",
      "taxes_included", "test", "confirmed", "source_name", "source_identifier",
      "confirmation_number", "send_receipt", "inventory_behaviour",
      "cancel_send_receipt", "cancel_refund", "order_status_url",
      "line_items_quantity", "total_weight", "cancel_reason", "cancelled_at",
      "closed_at", "processed_at", "created_at", "updated_at",
    ] },
    { label: "Totals", fields: [
      "total_price", "subtotal_price", "total_tax", "total_shipping",
      "total_discounts", "current_total_price", "total_refunded",
      "current_total_duties", "total_duties", "current_total_fees", "total_fees",
      "total_received", "net_payment", "total_capturable", "tax_lines",
    ] },
    { label: "Taxes", fields: ORDER_TAX_FIELDS },
    { label: "Browser", fields: [
      "browser_ip", "landing_page", "referrer_url", "source", "source_type",
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    ] },
    { label: "Company", fields: [
      "company_id", "company_name", "company_location_id", "company_location_name",
    ] },
    { label: "Risk", fields: ["risk_recommendation", "risk_level", "risk_facts"] },
    { label: "Customer", fields: [
      "customer_id", "customer_email", "customer_phone", "customer_first_name",
      "customer_last_name", "customer_note", "customer_state",
      "customer_orders_count", "customer_total_spent", "customer_tags",
      "customer_tax_exempt", "customer_email_marketing", "customer_sms_marketing",
    ] },
    { label: "Billing", fields: [
      "billing_first_name", "billing_last_name", "billing_name", "billing_company",
      "billing_phone", "billing_address1", "billing_address2", "billing_city",
      "billing_province", "billing_province_code", "billing_zip", "billing_country",
      "billing_country_code",
    ] },
    { label: "Shipping", fields: [
      "shipping_first_name", "shipping_last_name", "shipping_name",
      "shipping_company", "shipping_phone", "shipping_address1", "shipping_address2",
      "shipping_city", "shipping_province", "shipping_province_code", "shipping_zip",
      "shipping_country", "shipping_country_code", "shipping_line_title",
      "shipping_line_code", "shipping_line_source", "shipping_line_price",
      "shipping_line_tax",
    ] },
    { label: "Items", fields: [
      "line_item_id", "line_item_title", "line_item_name", "line_item_variant_title",
      "line_item_sku", "line_item_vendor", "line_item_quantity",
      "line_item_current_quantity", "line_item_unfulfilled_quantity",
      "line_item_price", "line_item_discounted_price", "line_item_total",
      "line_item_total_discount", "line_item_taxable", "line_item_requires_shipping",
      "line_item_gift_card", "line_item_properties", "line_item_fulfillment_status",
      "line_item_product_id", "line_item_variant_id", "line_item_product_handle",
    ] },
    { label: "Item Data", fields: [
      "line_item_product_type", "line_item_product_tags", "line_item_variant_barcode",
      "line_item_variant_weight", "line_item_variant_weight_unit",
      "line_item_variant_inventory_qty", "line_item_variant_cost",
      "line_item_variant_price", "line_item_variant_compare_at_price",
      "line_item_variant_country_of_origin", "line_item_variant_province_of_origin",
      "line_item_variant_hs_code",
    ] },
    { label: "Line Taxes", fields: LINE_TAX_FIELDS },
    { label: "Transactions", fields: [
      "transaction_id", "transaction_kind", "transaction_status", "transaction_gateway",
      "transaction_amount", "transaction_currency", "transaction_processed_at",
      "transaction_payment_id", "transaction_account_number", "transaction_error_code",
      "transaction_test", "transaction_parent_id",
      "transaction_payment_method", "transaction_wallet", "transaction_message",
      "transaction_cc_avs_result", "transaction_cc_bin", "transaction_cc_cvv_result",
      "transaction_cc_number", "transaction_cc_company", "transaction_device_id",
      "transaction_user_id",
    ] },
    { label: "Refunds", fields: [
      "refund_id", "refund_created_at", "refund_note", "refund_amount", "refund_currency",
      "refund_restock_type", "refund_restock_location", "refund_send_receipt",
      "refund_generate_transaction",
    ] },
    { label: "Fulfillments", fields: [
      "fulfillment_id", "fulfillment_display_status", "fulfillment_created_at",
      "fulfillment_updated_at", "fulfillment_total_quantity", "fulfillment_service",
      "fulfillment_location", "fulfillment_shipment_status", "fulfillment_send_receipt",
      "fulfillment_tracking_company", "fulfillment_tracking_number", "fulfillment_tracking_url",
    ] },
  ],
  customers: [
    { label: "Profile", fields: [
      "customer_id", "email", "command", "first_name", "last_name", "phone",
      "locale", "state", "email_marketing_state", "email_marketing_opt_in",
      "email_marketing_updated_at", "sms_marketing_state", "sms_marketing_opt_in",
      "sms_marketing_updated_at", "sms_marketing_source", "created_at", "updated_at",
      "note", "verified_email", "tax_exempt", "tags", "tags_command", "total_spent",
      "orders_count", "send_account_activation_email", "send_welcome_email",
      "password", "multipass_identifier",
    ] },
    { label: "Orders", fields: [
      "first_order_id", "first_order_name", "first_order_processed_at", "first_order_total",
      "last_order_id", "last_order_name", "last_order_processed_at", "last_order_total",
    ] },
    { label: "Address", fields: [
      "address_row_number", "address_top_row", "address_id", "address_command",
      "address_first_name", "address_last_name", "address_company", "address_phone",
      "address1", "address2", "address_city", "address_province",
      "address_province_code", "address_country", "address_country_code", "address_zip",
      "address_is_default",
    ] },
    { label: "Activation", fields: ["account_activation_url"] },
    { label: "Store Credit", fields: [
      "store_credit_currency", "store_credit_balance",
      "store_credit_txn_id", "store_credit_txn_command", "store_credit_txn_amount",
      "store_credit_txn_expire_at", "store_credit_txn_send_receipt",
      "store_credit_txn_created_at", "store_credit_txn_event",
      "store_credit_txn_remaining_balance",
    ] },
  ],
  collections: [
    { label: "Basics", fields: [
      "collection_id", "title", "handle", "description", "body_html",
      "collection_type", "sort_order", "template_suffix", "products_count",
      "updated_at",
    ] },
    { label: "Media", fields: ["image_url", "image_alt", "image_width", "image_height"] },
    { label: "SEO", fields: ["seo_title", "seo_description"] },
    { label: "Rules", fields: ["rules_match", "rules"] },
  ],
  discounts: [
    { label: "Basics", fields: [
      "discount_id", "title", "summary", "type", "method", "codes",
      "value_type", "value", "status", "starts_at", "ends_at",
      "created_at", "updated_at",
    ] },
    { label: "Usage", fields: ["usage_limit", "once_per_customer", "usage_count"] },
    { label: "Requirements", fields: ["minimum_subtotal", "minimum_quantity"] },
    { label: "Combines With", fields: [
      "combines_with_order", "combines_with_product", "combines_with_shipping",
    ] },
  ],
  pages: [
    { label: "Content", fields: [
      "page_id", "title", "handle", "body_html", "body_summary", "template_suffix",
    ] },
    { label: "Publishing", fields: [
      "published", "published_at", "created_at", "updated_at",
    ] },
  ],
  blogs: [{ label: "Blog", fields: BLOG_FIELDS }],
  articles: [
    { label: "Content", fields: [
      "article_id", "title", "handle", "author", "body_html", "summary",
      "tags", "published", "published_at", "template_suffix",
      "created_at", "updated_at",
    ] },
    { label: "Blog", fields: ["blog_id", "blog_handle", "blog_title"] },
    { label: "Media", fields: ["image_url", "image_alt"] },
  ],
  redirects: [
    { label: "Redirect", fields: ["redirect_id", "command", "path", "target"] },
  ],
  shop: [
    { label: "Shop", fields: [
      "shop_id", "name", "email", "contact_email", "domain", "primary_domain",
      "url", "currency", "timezone", "weight_unit", "plan_name", "plan_plus",
      "plan_partner_dev", "created_at", "updated_at",
    ] },
    { label: "Address", fields: [
      "address1", "address2", "address_city", "address_province",
      "address_province_code", "address_zip", "address_country",
      "address_country_code", "address_phone",
    ] },
  ],
  files: [
    { label: "File", fields: [
      "file_id", "type", "alt", "status", "url", "mime_type", "original_size",
      "width", "height", "duration", "created_at", "updated_at",
    ] },
  ],
  payouts: [
    { label: "Payout", fields: ["payout_id", "status", "issued_at", "amount", "currency"] },
    { label: "Summary", fields: [
      "charges_gross", "charges_fee", "refunds_gross", "refunds_fee",
      "adjustments_gross", "adjustments_fee", "reserved_funds_gross",
      "reserved_funds_fee", "retried_payouts_gross", "retried_payouts_fee",
    ] },
  ],
  menus: [
    { label: "Menu", fields: ["menu_id", "menu_handle", "menu_title", "menu_is_default"] },
    { label: "Item", fields: [
      "item_id", "item_title", "item_type", "item_url", "item_resource_id",
      "item_tags", "item_level",
    ] },
  ],
  companies: [
    { label: "Company", fields: [
      "company_id", "company_name", "company_external_id", "company_note",
      "contacts_count", "orders_count", "total_spent", "currency",
      "main_contact_id", "main_contact_name", "main_contact_email",
      "created_at", "updated_at",
    ] },
    { label: "Location", fields: [
      "location_id", "location_name", "location_external_id", "location_phone",
      "location_note",
    ] },
    { label: "Billing", fields: [
      "billing_address1", "billing_address2", "billing_city", "billing_province",
      "billing_zip", "billing_country", "billing_country_code", "billing_recipient",
      "billing_phone",
    ] },
    { label: "Shipping", fields: [
      "shipping_address1", "shipping_address2", "shipping_city", "shipping_province",
      "shipping_zip", "shipping_country", "shipping_country_code",
      "shipping_recipient", "shipping_phone",
    ] },
  ],
  activity: [
    { label: "Activity", fields: [
      "activity_id", "entity", "format", "status", "row_count", "filename",
      "error", "created_at", "completed_at",
    ] },
  ],
  metaobjects: [
    { label: "Metaobject", fields: [
      "metaobject_id", "handle", "type", "display_name", "fields", "updated_at",
    ] },
  ],
  metafields: [
    { label: "Definition", fields: [
      "definition_id", "namespace", "key", "name", "description", "owner_type",
      "type", "validations", "metafields_count",
    ] },
  ],
  translations: [
    { label: "Translation", fields: [
      "translatable_type", "translatable_id", "field", "locale", "source",
      "translated", "outdated",
    ] },
  ],
  locations: [
    { label: "Location", fields: [
      "location_id", "name", "active", "fulfills_online_orders", "ships_inventory",
    ] },
    { label: "Address", fields: [
      "address1", "address2", "address_city", "address_province",
      "address_province_code", "address_zip", "address_country",
      "address_country_code", "address_phone",
    ] },
  ],
  catalogs: [
    { label: "Catalog", fields: [
      "catalog_id", "title", "type", "status", "price_list_id", "price_list_name",
      "publication_id",
    ] },
  ],
  metaobject_definitions: [
    { label: "Definition", fields: [
      "definition_id", "type", "name", "description", "metaobjects_count",
      "field_definitions",
    ] },
  ],
  inventory_transfers: [
    { label: "Transfer", fields: [
      "transfer_id", "name", "status", "reference_name", "origin_location",
      "destination_location", "date_created",
    ] },
  ],
  definitions: [
    { label: "Definition", fields: [
      "kind", "definition_id", "namespace", "key", "name", "type", "owner_type",
      "description", "validations", "field_definitions", "metafields_count",
      "metaobjects_count",
    ] },
  ],
  content: [
    { label: "Content", fields: [
      "content_type", "id", "title", "handle", "body_html", "summary", "author",
      "tags", "image_url", "image_alt", "blog_id", "blog_handle", "blog_title",
      "published", "published_at", "template_suffix", "created_at", "updated_at",
    ] },
  ],
  draft_orders: [
    { label: "Draft", fields: [
      "draft_order_id", "name", "status", "email", "phone", "note", "tags",
      "currency", "taxes_included", "tax_exempt", "invoice_url",
      "created_at", "updated_at", "completed_at",
    ] },
    { label: "Totals", fields: [
      "total_price", "subtotal_price", "total_tax", "total_shipping", "total_discounts",
    ] },
    { label: "Customer", fields: [
      "customer_id", "customer_email", "customer_first_name", "customer_last_name",
    ] },
    { label: "Billing", fields: [
      "billing_first_name", "billing_last_name", "billing_name", "billing_company",
      "billing_phone", "billing_address1", "billing_address2", "billing_city",
      "billing_province", "billing_province_code", "billing_zip", "billing_country",
      "billing_country_code",
    ] },
    { label: "Shipping", fields: [
      "shipping_first_name", "shipping_last_name", "shipping_name", "shipping_company",
      "shipping_phone", "shipping_address1", "shipping_address2", "shipping_city",
      "shipping_province", "shipping_province_code", "shipping_zip", "shipping_country",
      "shipping_country_code", "shipping_line_title", "shipping_line_price",
    ] },
    { label: "Items", fields: [
      "line_item_id", "line_item_title", "line_item_name", "line_item_variant_title",
      "line_item_sku", "line_item_vendor", "line_item_quantity", "line_item_price",
      "line_item_discounted_price", "line_item_taxable", "line_item_requires_shipping",
      "line_item_gift_card", "line_item_properties", "line_item_product_id",
      "line_item_variant_id",
    ] },
  ],
};

// Smart and Custom Collections share the Collection column shape/groups; they
// differ only by which collections the query returns (collection_type filter).
COLUMN_GROUPS_BY_ENTITY.smart_collections = COLUMN_GROUPS_BY_ENTITY.collections;
COLUMN_GROUPS_BY_ENTITY.custom_collections = COLUMN_GROUPS_BY_ENTITY.collections;

/**
 * Human-readable column labels shown in the export UI (Matrixify-style).
 * The export file headers still use the snake_case keys above — these are
 * display-only. Fields without an entry fall back to their raw key.
 */
export const FIELD_LABELS = {
  // Products — Basic Columns
  product_id: "ID",
  handle: "Handle",
  command: "Command",
  title: "Title",
  body_html: "Body HTML",
  vendor: "Vendor",
  product_type: "Type",
  tags: "Tags",
  tags_command: "Tags Command",
  created_at: "Created At",
  updated_at: "Updated At",
  status: "Status",
  published: "Published",
  published_at: "Published At",
  published_scope: "Published Scope",
  template_suffix: "Template Suffix",
  gift_card: "Gift Card",
  url: "URL",
  total_inventory_qty: "Total Inventory Qty",
  row_number: "Row #",
  top_row: "Top Row",
  // Products — Category / Media
  category_id: "Category ID",
  category_name: "Category Name",
  category_tree: "Category Tree",
  custom_collections: "Custom Collections",
  smart_collections: "Smart Collections",
  image_type: "Image Type",
  image_url: "Image Src",
  image_command: "Image Command",
  image_position: "Image Position",
  image_width: "Image Width",
  image_height: "Image Height",
  image_alt: "Image Alt Text",
  // Products — Inventory / Variants
  variant_inventory_item_id: "Variant Inventory Item ID",
  variant_id: "Variant ID",
  variant_command: "Variant Command",
  option1_name: "Option1 Name",
  option1_value: "Option1 Value",
  option2_name: "Option2 Name",
  option2_value: "Option2 Value",
  option3_name: "Option3 Name",
  option3_value: "Option3 Value",
  variant_position: "Variant Position",
  sku: "Variant SKU",
  price: "Variant Price",
  compare_at_price: "Variant Compare At Price",
  inventory_qty: "Variant Inventory Qty",
  inventory_policy: "Variant Inventory Policy",
  inventory_tracker: "Variant Inventory Tracker",
  requires_shipping: "Variant Requires Shipping",
  barcode: "Variant Barcode",
  weight: "Variant Weight",
  weight_unit: "Variant Weight Unit",
  taxable: "Variant Taxable",
  variant_image: "Variant Image",
  variant_fulfillment_service: "Variant Fulfillment Service",
  variant_shipping_profile: "Variant Shipping Profile",
  variant_inventory_adjust: "Variant Inventory Adjust",
  // Products — Variant Cost / Customs
  variant_cost: "Variant Cost",
  variant_country_of_origin: "Variant Country of Origin",
  variant_province_of_origin: "Variant Province of Origin",
  variant_hs_code: "Variant HS Code",

  // Orders — Order
  order_id: "ID",
  order_name: "Name",
  order_number: "Number",
  financial_status: "Payment Status",
  fulfillment_status: "Fulfillment Status",
  presentment_currency: "Presentment Currency",
  taxes_included: "Taxes Included",
  test: "Test",
  confirmed: "Confirmed",
  source_name: "Source",
  order_status_url: "Order Status URL",
  line_items_quantity: "Line Items Quantity",
  total_weight: "Total Weight (g)",
  cancelled_at: "Cancelled At",
  closed_at: "Closed At",
  processed_at: "Processed At",
  // Orders — Totals
  total_price: "Total",
  subtotal_price: "Subtotal",
  total_tax: "Total Tax",
  total_shipping: "Total Shipping",
  total_discounts: "Total Discounts",
  current_total_price: "Current Total",
  total_refunded: "Total Refunded",
  tax_lines: "Tax Lines",
  // Orders — Buyer
  customer_id: "Customer ID",
  customer_email: "Customer Email",
  customer_phone: "Customer Phone",
  customer_first_name: "Customer First Name",
  customer_last_name: "Customer Last Name",
  customer_note: "Customer Note",
  customer_state: "Customer State",
  customer_orders_count: "Customer Orders Count",
  customer_total_spent: "Customer Total Spent",
  customer_tags: "Customer Tags",
  customer_tax_exempt: "Customer Tax Exempt",
  customer_email_marketing: "Customer Email Marketing",
  customer_sms_marketing: "Customer SMS Marketing",
  // Orders — Billing
  billing_first_name: "Billing First Name",
  billing_last_name: "Billing Last Name",
  billing_name: "Billing Name",
  billing_company: "Billing Company",
  billing_phone: "Billing Phone",
  billing_address1: "Billing Address 1",
  billing_address2: "Billing Address 2",
  billing_city: "Billing City",
  billing_province: "Billing Province",
  billing_province_code: "Billing Province Code",
  billing_zip: "Billing Zip",
  billing_country: "Billing Country",
  billing_country_code: "Billing Country Code",
  // Orders — Shipping
  shipping_first_name: "Shipping First Name",
  shipping_last_name: "Shipping Last Name",
  shipping_name: "Shipping Name",
  shipping_company: "Shipping Company",
  shipping_phone: "Shipping Phone",
  shipping_address1: "Shipping Address 1",
  shipping_address2: "Shipping Address 2",
  shipping_city: "Shipping City",
  shipping_province: "Shipping Province",
  shipping_province_code: "Shipping Province Code",
  shipping_zip: "Shipping Zip",
  shipping_country: "Shipping Country",
  shipping_country_code: "Shipping Country Code",
  shipping_line_title: "Shipping Line Title",
  shipping_line_code: "Shipping Line Code",
  shipping_line_price: "Shipping Line Price",
  // Orders — Items
  line_item_id: "Line: ID",
  line_item_title: "Line: Title",
  line_item_name: "Line: Name",
  line_item_variant_title: "Line: Variant Title",
  line_item_sku: "Line: SKU",
  line_item_vendor: "Line: Vendor",
  line_item_quantity: "Line: Quantity",
  line_item_current_quantity: "Line: Current Quantity",
  line_item_price: "Line: Price",
  line_item_discounted_price: "Line: Discounted Price",
  line_item_total_discount: "Line: Total Discount",
  line_item_taxable: "Line: Taxable",
  line_item_requires_shipping: "Line: Requires Shipping",
  line_item_gift_card: "Line: Gift Card",
  line_item_properties: "Line: Properties",
  line_item_fulfillment_status: "Line: Fulfillment Status",
  line_item_product_id: "Line: Product ID",
  line_item_variant_id: "Line: Variant ID",
  line_item_product_handle: "Line: Product Handle",
  // Orders — Item Data
  line_item_product_type: "Line: Product Type",
  line_item_product_tags: "Line: Product Tags",
  line_item_variant_barcode: "Line: Variant Barcode",
  line_item_variant_weight: "Line: Variant Weight",
  line_item_variant_weight_unit: "Line: Variant Weight Unit",
  line_item_variant_inventory_qty: "Line: Variant Inventory Qty",
  line_item_variant_cost: "Line: Variant Cost",
  line_item_variant_price: "Line: Variant Price",
  line_item_variant_compare_at_price: "Line: Variant Compare At Price",
  line_item_variant_country_of_origin: "Line: Variant Country of Origin",
  line_item_variant_province_of_origin: "Line: Variant Province of Origin",
  line_item_variant_hs_code: "Line: Variant HS Code",

  // Customers (shared address/profile keys; created_at/updated_at/tags inherited above)
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  phone: "Phone",
  note: "Note",
  locale: "Language",
  verified_email: "Verified Email",
  state: "State",
  tax_exempt: "Tax Exempt",
  orders_count: "Orders Count",
  total_spent: "Total Spent",
  total_spent_currency: "Total Spent Currency",
  email_marketing_state: "Email Marketing Status",
  email_marketing_opt_in: "Email Marketing Level",
  email_marketing_updated_at: "Email Marketing Updated At",
  sms_marketing_state: "SMS Marketing Status",
  sms_marketing_opt_in: "SMS Marketing Level",
  sms_marketing_updated_at: "SMS Marketing Updated At",
  address_first_name: "Address First Name",
  address_last_name: "Address Last Name",
  address_name: "Address Name",
  address_company: "Address Company",
  address_phone: "Address Phone",
  address1: "Address Line 1",
  address2: "Address Line 2",
  address_city: "Address City",
  address_province: "Address Province",
  address_province_code: "Address Province Code",
  address_zip: "Address Zip",
  address_country: "Address Country",
  address_country_code: "Address Country Code",

  // Collections (title/handle/body_html/image_*/updated_at inherited above)
  collection_id: "ID",
  description: "Description",
  collection_type: "Type",
  sort_order: "Sort Order",
  products_count: "Products Count",
  seo_title: "SEO Title",
  seo_description: "SEO Description",
  rules_match: "Rules Match",
  rules: "Rules",

  // Discounts (title/status/created_at/updated_at inherited above)
  discount_id: "ID",
  summary: "Summary",
  type: "Type",
  method: "Method",
  codes: "Codes",
  value_type: "Value Type",
  value: "Value",
  starts_at: "Starts At",
  ends_at: "Ends At",
  usage_limit: "Usage Limit",
  once_per_customer: "Once Per Customer",
  usage_count: "Usage Count",
  minimum_subtotal: "Minimum Subtotal",
  minimum_quantity: "Minimum Quantity",
  combines_with_order: "Combines With Order Discounts",
  combines_with_product: "Combines With Product Discounts",
  combines_with_shipping: "Combines With Shipping Discounts",

  // Pages / Blogs / Articles (published/published_at/summary/title/handle inherited above)
  page_id: "ID",
  body_summary: "Body Summary",
  comment_policy: "Comment Policy",
  article_id: "ID",
  blog_id: "Blog ID",
  blog_handle: "Blog Handle",
  blog_title: "Blog Title",
  author: "Author",

  // Redirects (command inherited above)
  redirect_id: "ID",
  path: "Path",
  target: "Target",

  // Shop (name/email/created_at/updated_at/address_* inherited above)
  shop_id: "ID",
  contact_email: "Contact Email",
  domain: "Domain",
  primary_domain: "Primary Domain",
  url: "URL",
  currency: "Currency",
  timezone: "Timezone",
  weight_unit: "Weight Unit",
  plan_name: "Plan Name",
  plan_plus: "Shopify Plus",
  plan_partner_dev: "Partner Development",

  // Files (type/status/url/created_at/updated_at inherited above)
  file_id: "ID",
  alt: "Alt Text",
  mime_type: "MIME Type",
  original_size: "Original Size",
  width: "Width",
  height: "Height",
  duration: "Duration",

  // Payouts (status/amount/currency inherited above)
  payout_id: "ID",
  issued_at: "Issued At",
  charges_gross: "Charges Gross",
  charges_fee: "Charges Fee",
  refunds_gross: "Refunds Gross",
  refunds_fee: "Refunds Fee",
  adjustments_gross: "Adjustments Gross",
  adjustments_fee: "Adjustments Fee",
  reserved_funds_gross: "Reserved Funds Gross",
  reserved_funds_fee: "Reserved Funds Fee",
  retried_payouts_gross: "Retried Payouts Gross",
  retried_payouts_fee: "Retried Payouts Fee",

  // Menus
  menu_id: "Menu ID",
  menu_handle: "Menu Handle",
  menu_title: "Menu Title",
  menu_is_default: "Default Menu",
  item_id: "Item ID",
  item_title: "Item Title",
  item_type: "Item Type",
  item_url: "Item URL",
  item_resource_id: "Item Resource ID",
  item_tags: "Item Tags",
  item_level: "Item Level",

  // Companies (orders_count/total_spent/currency/created_at/updated_at + billing_*/shipping_* inherited above)
  company_id: "Company ID",
  company_name: "Company Name",
  company_external_id: "Company External ID",
  company_note: "Company Note",
  contacts_count: "Contacts Count",
  main_contact_id: "Main Contact ID",
  main_contact_name: "Main Contact Name",
  main_contact_email: "Main Contact Email",
  location_id: "Location ID",
  location_name: "Location Name",
  location_external_id: "Location External ID",
  location_phone: "Location Phone",
  location_note: "Location Note",
  billing_recipient: "Billing Recipient",
  shipping_recipient: "Shipping Recipient",

  // Draft Orders (most fields inherited from Orders above)
  draft_order_id: "ID",
  invoice_url: "Invoice URL",
  completed_at: "Completed At",

  // Activity (status/created_at inherited above)
  activity_id: "ID",
  entity: "Entity",
  format: "Format",
  row_count: "Row Count",
  filename: "Filename",
  error: "Error",

  // Metaobjects (handle/type/updated_at inherited above)
  metaobject_id: "ID",
  display_name: "Display Name",
  fields: "Fields",

  // Metafields (definitions; type/description inherited above)
  definition_id: "ID",
  namespace: "Namespace",
  key: "Key",
  name: "Name",
  owner_type: "Owner Type",
  validations: "Validations",
  metafields_count: "Metafields Count",

  // Translations
  translatable_type: "Resource Type",
  translatable_id: "Resource ID",
  field: "Field",
  locale: "Locale",
  source: "Source",
  translated: "Translated",
  outdated: "Outdated",

  // Locations (name/address_* inherited above)
  location_id: "ID",
  active: "Active",
  fulfills_online_orders: "Fulfills Online Orders",
  ships_inventory: "Ships Inventory",

  // Catalogs (title/type/status inherited above)
  catalog_id: "ID",
  price_list_id: "Price List ID",
  price_list_name: "Price List Name",
  publication_id: "Publication ID",

  // Metaobject Definitions (definition_id/type/name/description inherited above)
  metaobjects_count: "Metaobjects Count",
  field_definitions: "Field Definitions",

  // Inventory Transfers (name/status inherited above)
  transfer_id: "ID",
  reference_name: "Reference",
  origin_location: "Origin",
  destination_location: "Destination",
  date_created: "Date Created",

  // Merged entities
  kind: "Kind",
  content_type: "Content Type",
  id: "ID",

  // Customers — expanded (Matrixify 64-column parity)
  sms_marketing_source: "SMS Marketing Source",
  send_account_activation_email: "Send Account Activation Email",
  send_welcome_email: "Send Welcome Email",
  password: "Password",
  multipass_identifier: "Multipass Identifier",
  first_order_id: "First Order ID",
  first_order_name: "First Order Name",
  first_order_processed_at: "First Order Processed At",
  first_order_total: "First Order Total",
  last_order_id: "Last Order ID",
  last_order_name: "Last Order Name",
  last_order_processed_at: "Last Order Processed At",
  last_order_total: "Last Order Total",
  address_row_number: "Address Row #",
  address_top_row: "Address Top Row",
  address_id: "Address ID",
  address_command: "Address Command",
  address_is_default: "Address Is Default",
  account_activation_url: "Account Activation URL",
  store_credit_currency: "Store Credit Currency",
  store_credit_balance: "Store Credit Balance",
  store_credit_txn_id: "Store Credit Transaction ID",
  store_credit_txn_command: "Store Credit Transaction Command",
  store_credit_txn_amount: "Store Credit Transaction Amount",
  store_credit_txn_expire_at: "Store Credit Transaction Expire At",
  store_credit_txn_send_receipt: "Store Credit Transaction Send Receipt",
  store_credit_txn_created_at: "Store Credit Transaction Created At",
  store_credit_txn_event: "Store Credit Transaction Event",
  store_credit_txn_remaining_balance: "Store Credit Transaction Remaining Balance",

  // Orders — expanded (Matrixify flat-column parity)
  source_identifier: "Source Identifier",
  confirmation_number: "Confirmation Number",
  current_total_duties: "Current Total Duties",
  total_duties: "Total Duties",
  current_total_fees: "Current Total Fees",
  total_fees: "Total Fees",
  total_received: "Total Received",
  net_payment: "Net Payment",
  total_capturable: "Total Capturable",
  browser_ip: "Browser IP",
  landing_page: "Landing Page",
  referrer_url: "Referrer URL",
  source: "Source",
  source_type: "Source Type",
  utm_source: "UTM Source",
  utm_medium: "UTM Medium",
  utm_campaign: "UTM Campaign",
  utm_term: "UTM Term",
  utm_content: "UTM Content",
  company_location_id: "Company Location ID",
  company_location_name: "Company Location Name",
  shipping_line_source: "Shipping Line Source",
  shipping_line_tax: "Shipping Line Tax",
  line_item_unfulfilled_quantity: "Line: Unfulfilled Quantity",
  line_item_total: "Line: Total",

  // Orders — multi-row architecture
  line_type: "Line Type",
  top_row: "Top Row",
  row_number: "Row #",
  transaction_id: "Transaction ID",
  transaction_kind: "Transaction Kind",
  transaction_status: "Transaction Status",
  transaction_gateway: "Transaction Gateway",
  transaction_amount: "Transaction Amount",
  transaction_currency: "Transaction Currency",
  transaction_processed_at: "Transaction Processed At",
  transaction_payment_id: "Transaction Payment ID",
  transaction_account_number: "Transaction Account Number",
  transaction_error_code: "Transaction Error Code",
  transaction_test: "Transaction Test",
  transaction_parent_id: "Transaction Parent ID",
  transaction_payment_method: "Transaction Payment Method",
  transaction_wallet: "Transaction Wallet",
  transaction_message: "Transaction Message",
  transaction_cc_avs_result: "Transaction CC AVS Result",
  transaction_cc_bin: "Transaction CC Bin",
  transaction_cc_cvv_result: "Transaction CC CVV Result",
  transaction_cc_number: "Transaction CC Number",
  transaction_cc_company: "Transaction CC Company",
  transaction_device_id: "Transaction Device ID",
  transaction_user_id: "Transaction User ID",
  send_receipt: "Send Receipt",
  inventory_behaviour: "Inventory Behaviour",
  cancel_send_receipt: "Cancel: Send Receipt",
  cancel_refund: "Cancel: Refund",
  refund_send_receipt: "Refund Send Receipt",
  refund_generate_transaction: "Refund Generate Transaction",
  fulfillment_shipment_status: "Fulfillment Shipment Status",
  fulfillment_send_receipt: "Fulfillment Send Receipt",
  refund_id: "Refund ID",
  refund_created_at: "Refund Created At",
  refund_note: "Refund Note",
  refund_amount: "Refund Amount",
  refund_currency: "Refund Currency",
  refund_restock_type: "Refund Restock Type",
  refund_restock_location: "Refund Restock Location",
  risk_recommendation: "Risk Recommendation",
  risk_level: "Risk Level",
  risk_facts: "Risk Facts",
  fulfillment_id: "Fulfillment ID",
  fulfillment_display_status: "Fulfillment Status",
  fulfillment_created_at: "Fulfillment Created At",
  fulfillment_updated_at: "Fulfillment Updated At",
  fulfillment_total_quantity: "Fulfillment Total Quantity",
  fulfillment_service: "Fulfillment Service",
  fulfillment_location: "Fulfillment Location",
  fulfillment_tracking_company: "Fulfillment Tracking Company",
  fulfillment_tracking_number: "Fulfillment Tracking Number",
  fulfillment_tracking_url: "Fulfillment Tracking URL",

  // Products — Matrixify parity padding
  collection: "Collection",
  image_attachment: "Image Attachment",
  variant_generate_from_options: "Variant Generate From Options",
  variant_grams: "Variant Grams",
  variant_tax_code: "Variant Tax Code",
  gs_google_product_category: "Google: Product Category",
  gs_custom_product: "Google: Custom Product",
  gs_gmc_id: "Google: GMC ID",
  gs_mpn: "Google: MPN",
  gs_age_group: "Google: Age Group",
  gs_gender: "Google: Gender",
  gs_condition: "Google: Condition",
  gs_color: "Google: Color",
  gs_material: "Google: Material",
  gs_size: "Google: Size",
  gs_size_system: "Google: Size System",
};

// Numbered tax-line labels: "Tax 1 Title", "Line Tax 1 Rate", etc.
for (let i = 1; i <= 5; i++) {
  for (const [suffix, label] of [["title", "Title"], ["rate", "Rate"], ["price", "Price"], ["channel_liable", "Channel Liable"]]) {
    FIELD_LABELS[`tax_${i}_${suffix}`] = `Tax ${i} ${label}`;
    FIELD_LABELS[`line_tax_${i}_${suffix}`] = `Line Tax ${i} ${label}`;
  }
}

/**
 * Realistic example values shown as the placeholder in the filter "Value"
 * input, so a merchant sees the expected format for the field they picked
 * (e.g. a real-looking Shopify ID pair for an ID column). Curated per field;
 * anything not listed falls back to the pattern rules in placeholderFor().
 */
export const FIELD_EXAMPLES = {
  // Products — basics
  handle: "blue-cotton-tshirt",
  command: "MERGE",
  title: "Blue Cotton T-Shirt",
  body_html: "<p>Soft ringspun cotton tee</p>",
  vendor: "Nike",
  product_type: "T-Shirts",
  tags: "sale, summer, cotton",
  tags_command: "REPLACE",
  status: "active",
  published: "true",
  published_scope: "global",
  template_suffix: "special",
  gift_card: "false",
  url: "https://your-store.myshopify.com/products/blue-cotton-tshirt",
  total_inventory_qty: "150",
  row_number: "1",
  top_row: "true",
  // Products — category / collections / media
  category_id: "aa-1-13-8",
  category_name: "T-Shirts",
  category_tree: "Apparel & Accessories > Clothing > Shirts & Tops",
  custom_collections: "Summer Sale, New Arrivals",
  smart_collections: "Best Sellers",
  image_type: "Image",
  image_command: "MERGE",
  image_position: "1",
  image_width: "2048",
  image_height: "2048",
  image_alt: "Front view of blue t-shirt",
  // Products — variants
  variant_command: "MERGE",
  option1_name: "Size", option1_value: "Medium",
  option2_name: "Color", option2_value: "Blue",
  option3_name: "Material", option3_value: "Cotton",
  variant_position: "1",
  sku: "TSHIRT-BLU-M",
  barcode: "012345678905",
  price: "29.99",
  compare_at_price: "39.99",
  variant_cost: "12.50",
  taxable: "true",
  inventory_tracker: "shopify",
  inventory_policy: "deny",
  inventory_qty: "150",
  variant_inventory_adjust: "10",
  variant_fulfillment_service: "manual",
  requires_shipping: "true",
  variant_shipping_profile: "General Profile",
  weight: "0.5",
  weight_unit: "kg",
  variant_country_of_origin: "US",
  variant_province_of_origin: "CA",
  variant_hs_code: "6109.10.00",
  // Orders
  order_name: "#1001",
  financial_status: "paid",
  fulfillment_status: "fulfilled",
  currency: "USD",
  total_price: "129.99",
  subtotal_price: "119.99",
  total_tax: "10.00",
  total_shipping: "9.99",
  total_discounts: "5.00",
  note: "Leave at the front door",
  cancel_reason: "customer",
  customer_first_name: "Jane", customer_last_name: "Doe",
  line_item_title: "Blue Cotton T-Shirt",
  line_item_variant_title: "Medium / Blue",
  line_item_sku: "TSHIRT-BLU-M",
  line_item_vendor: "Nike",
  line_item_quantity: "2",
  line_item_price: "29.99",
  line_item_discounted_price: "24.99",
  line_item_total_discount: "5.00",
  line_item_taxable: "true",
  line_item_requires_shipping: "true",
  line_item_fulfillment_status: "fulfilled",
  order_number: "1001",
  presentment_currency: "USD",
  taxes_included: "false",
  test: "false",
  confirmed: "true",
  source_name: "web",
  line_items_quantity: "3",
  total_weight: "1500",
  current_total_price: "129.99",
  total_refunded: "0.00",
  tax_lines: "VAT 20% 4.00",
  customer_note: "VIP customer",
  customer_state: "enabled",
  customer_orders_count: "12",
  customer_total_spent: "1499.50",
  customer_tax_exempt: "false",
  customer_email_marketing: "SUBSCRIBED",
  customer_sms_marketing: "NOT_SUBSCRIBED",
  customer_tags: "vip, wholesale",
  billing_province_code: "ON", shipping_province_code: "ON",
  billing_country_code: "CA", shipping_country_code: "CA",
  billing_name: "Jane Doe", shipping_name: "Jane Doe",
  shipping_line_title: "Standard", shipping_line_code: "STANDARD", shipping_line_price: "9.99",
  line_item_name: "Blue Cotton T-Shirt - Medium / Blue",
  line_item_current_quantity: "2",
  line_item_gift_card: "false",
  line_item_properties: "Engraving: John",
  line_item_product_handle: "blue-cotton-tshirt",
  line_item_product_type: "T-Shirts",
  line_item_product_tags: "sale, summer",
  line_item_variant_barcode: "012345678905",
  line_item_variant_weight: "0.5",
  line_item_variant_weight_unit: "kg",
  line_item_variant_inventory_qty: "150",
  line_item_variant_cost: "12.50",
  line_item_variant_price: "29.99",
  line_item_variant_compare_at_price: "39.99",
  line_item_variant_country_of_origin: "US",
  line_item_variant_province_of_origin: "CA",
  line_item_variant_hs_code: "6109.10.00",
  // Customers
  first_name: "Jane", last_name: "Doe",
  verified_email: "true",
  state: "enabled",
  orders_count: "12",
  total_spent: "1499.50",
  total_spent_currency: "USD",
  email_marketing_state: "SUBSCRIBED",
  email_marketing_opt_in: "SINGLE_OPT_IN",
  email_marketing_updated_at: "2024-03-15",
  sms_marketing_state: "NOT_SUBSCRIBED",
  sms_marketing_opt_in: "SINGLE_OPT_IN",
  sms_marketing_updated_at: "2024-03-15",
  locale: "en",
  tax_exempt: "false",
  address_first_name: "Jane", address_last_name: "Doe", address_name: "Jane Doe",
  // Addresses (customer + billing/shipping)
  address_company: "Acme Inc.", billing_company: "Acme Inc.", shipping_company: "Acme Inc.",
  address1: "150 Elgin St", billing_address1: "150 Elgin St", shipping_address1: "150 Elgin St",
  address2: "Suite 800", billing_address2: "Suite 800", shipping_address2: "Suite 800",
  address_city: "Ottawa", billing_city: "Ottawa", shipping_city: "Ottawa",
  address_province: "Ontario", billing_province: "Ontario", shipping_province: "Ontario",
  address_province_code: "ON",
  address_zip: "K2P 1L4", billing_zip: "K2P 1L4", shipping_zip: "K2P 1L4",
  address_country: "Canada", billing_country: "Canada", shipping_country: "Canada",
  address_country_code: "CA",
  // Collections
  collection_type: "smart",
  sort_order: "best-selling",
  products_count: "24",
  seo_title: "Summer Sale T-Shirts",
  seo_description: "Shop our summer collection of cotton tees",
  rules_match: "all",
  rules: "tag equals sale",
  description: "Soft ringspun cotton tee",
  // Discounts
  type: "Percentage",
  method: "Code",
  codes: "SUMMER20",
  value_type: "percentage",
  value: "20",
  usage_limit: "100",
  once_per_customer: "true",
  usage_count: "37",
  minimum_subtotal: "50.00",
  minimum_quantity: "3",
  combines_with_order: "false",
  combines_with_product: "true",
  combines_with_shipping: "false",
  // Pages / blogs / articles
  body_summary: "A short summary of the page",
  author: "Jane Doe",
  summary: "A short summary of the article",
  comment_policy: "moderated",
  blog_handle: "news",
  blog_title: "Company News",
  // Redirects
  path: "/old-product-url",
  target: "/products/new-product-handle",
};

/**
 * Placeholder/example value for a filter field. Prefers the curated
 * FIELD_EXAMPLES entry, then falls back to format-based rules (IDs, dates,
 * emails, phones), and finally to the human label so every field shows
 * something useful.
 */
export function placeholderFor(field) {
  if (FIELD_EXAMPLES[field]) return FIELD_EXAMPLES[field];
  if (/(^|_)id$/.test(field)) return "1784628715, 2659713148";
  if (/_at$/.test(field)) return "2024-03-15";
  if (/email/.test(field)) return "jane@example.com";
  if (/phone/.test(field)) return "+1 555 123 4567";
  return FIELD_LABELS[field] ?? field;
}

/**
 * Sensible default column selection per entity (Matrixify's "Default
 * Columns" preset). Subset of FIELDS_BY_ENTITY[entity].
 */
export const DEFAULT_FIELDS_BY_ENTITY = {
  products:    ["product_id", "title", "handle", "status", "vendor", "sku", "price", "inventory_qty"],
  orders:      ["line_type", "order_id", "order_name", "email", "financial_status", "fulfillment_status", "total_price", "currency", "created_at"],
  customers:   ["customer_id", "first_name", "last_name", "email", "orders_count", "total_spent", "state"],
  collections: ["collection_id", "title", "handle", "collection_type"],
  smart_collections:  ["collection_id", "title", "handle", "rules_match", "rules"],
  custom_collections: ["collection_id", "title", "handle", "products_count"],
  discounts:   ["discount_id", "title", "type", "status", "codes", "value_type", "value"],
  pages:       ["page_id", "title", "handle", "published"],
  blogs:       ["blog_id", "title", "handle"],
  articles:    ["article_id", "blog_handle", "title", "handle", "author", "published"],
  redirects:   ["redirect_id", "path", "target"],
  shop:        ["shop_id", "name", "domain", "email", "currency", "plan_name"],
  files:       ["file_id", "type", "alt", "url", "status", "mime_type"],
  payouts:     ["payout_id", "status", "issued_at", "amount", "currency"],
  menus:       ["menu_handle", "menu_title", "item_title", "item_type", "item_url", "item_level"],
  companies:   ["company_id", "company_name", "location_name", "main_contact_email", "total_spent"],
  draft_orders: ["draft_order_id", "name", "status", "email", "total_price", "created_at"],
  activity:    ["activity_id", "entity", "format", "status", "row_count", "created_at"],
  metaobjects: ["metaobject_id", "handle", "type", "display_name", "updated_at"],
  metafields:  ["namespace", "key", "name", "owner_type", "type"],
  translations: ["translatable_type", "translatable_id", "field", "locale", "translated"],
  locations:   ["location_id", "name", "active", "address_city", "address_country"],
  catalogs:    ["catalog_id", "title", "type", "status"],
  metaobject_definitions: ["definition_id", "type", "name", "metaobjects_count"],
  inventory_transfers: ["transfer_id", "name", "status", "origin_location", "destination_location"],
  definitions: ["kind", "namespace", "key", "name", "type", "owner_type"],
  content:     ["content_type", "id", "title", "handle", "published"],
};
