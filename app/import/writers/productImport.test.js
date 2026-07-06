/**
 * import/writers/productImport.test.js
 *
 * Proves the products import vertical: assembled rows → productSet input, the
 * Command dispatch, record-aware validation, and a full export→CSV→import
 * round-trip. Run with `npm test`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { toCSV } from "../../export/formats/csv.js";
import { PRODUCT_FIELDS } from "../../export/fieldLists.js";
import { parseCSV } from "../parsers/csv.js";
import { normalizeHeaders } from "../headers.js";
import { groupRecords } from "../assemble.js";
import { COMMAND } from "../command.js";
import { validateProductRows } from "../validators/products.js";
import { buildProductSetInput } from "./productSetInput.js";

const MF_PRODUCT = "Metafield: custom.care [single_line_text_field]";
const MF_VARIANT = "Variant Metafield: custom.gtin [single_line_text_field]";

/** A 2-variant product with 2 images + product/variant metafields. */
function productGroup(overrides = {}) {
  const top = {
    top_row: "TRUE", command: "", product_id: "123", title: "Tee", handle: "tee",
    body_html: "<p>Soft</p>", vendor: "Nike", product_type: "Shirts", status: "ACTIVE",
    tags: "a, b", seo_title: "Best Tee", category_id: "aa-1-13-8",
    option1_name: "Color", option1_value: "Red",
    variant_id: "11", sku: "R", price: "9.99", compare_at_price: "12.99",
    taxable: "true", weight: "0.5", weight_unit: "KILOGRAMS", variant_cost: "5",
    inventory_policy: "DENY", variant_hs_code: "6109",
    image_url: "https://x/1.jpg", image_alt: "front",
    [MF_PRODUCT]: "wash cold", [MF_VARIANT]: "g1",
    ...overrides,
  };
  const second = {
    top_row: "", command: "", option1_name: "Color", option1_value: "Blue",
    variant_id: "12", sku: "B", price: "9.99",
    image_url: "https://x/2.jpg", image_alt: "back", [MF_VARIANT]: "g2",
  };
  return [top, second];
}

test("buildProductSetInput maps a full product group", () => {
  const { command, identifier, input } = buildProductSetInput(productGroup());

  assert.equal(command, COMMAND.MERGE);
  assert.deepEqual(identifier, { id: "gid://shopify/Product/123" });
  // The id must NOT be in input — productSet rejects id + identifier together.
  assert.equal(input.id, undefined);
  assert.equal(input.title, "Tee");
  assert.equal(input.descriptionHtml, "<p>Soft</p>");
  assert.deepEqual(input.tags, ["a", "b"]);
  assert.equal(input.status, "ACTIVE");
  assert.equal(input.seo.title, "Best Tee");
  assert.equal(input.category, "gid://shopify/TaxonomyCategory/aa-1-13-8");

  assert.deepEqual(input.productOptions, [
    { name: "Color", values: [{ name: "Red" }, { name: "Blue" }] },
  ]);

  assert.equal(input.variants.length, 2);
  const [v0] = input.variants;
  assert.deepEqual(v0.optionValues, [{ optionName: "Color", name: "Red" }]);
  assert.equal(v0.id, "gid://shopify/ProductVariant/11");
  assert.equal(v0.price, "9.99");
  assert.equal(v0.compareAtPrice, "12.99");
  assert.equal(v0.inventoryPolicy, "DENY");
  assert.equal(v0.taxable, true);
  assert.equal(v0.inventoryItem.cost, "5");
  assert.deepEqual(v0.inventoryItem.measurement, { weight: { value: 0.5, unit: "KILOGRAMS" } });
  assert.equal(v0.inventoryItem.harmonizedSystemCode, "6109");

  // metafields split correctly between product and variant
  assert.deepEqual(input.metafields, [
    { namespace: "custom", key: "care", type: "single_line_text_field", value: "wash cold" },
  ]);
  assert.deepEqual(v0.metafields, [
    { namespace: "custom", key: "gtin", type: "single_line_text_field", value: "g1" },
  ]);

  // both images collected as files
  assert.equal(input.files.length, 2);
  assert.deepEqual(input.files[0], { originalSource: "https://x/1.jpg", contentType: "IMAGE", alt: "front" });
});

test("Command dispatch: NEW omits identifier, DELETE identifies by id", () => {
  const asNew = buildProductSetInput(productGroup({ command: "NEW" }));
  assert.equal(asNew.command, COMMAND.NEW);
  assert.equal(asNew.identifier, undefined);
  assert.equal(asNew.input.id, undefined);

  const asDelete = buildProductSetInput(productGroup({ command: "DELETE" }));
  assert.equal(asDelete.command, COMMAND.DELETE);
  assert.deepEqual(asDelete.identifier, { id: "gid://shopify/Product/123" });
});

test("builder falls back to handle identifier when no id", () => {
  const { identifier, input } = buildProductSetInput(productGroup({ product_id: "" }));
  assert.deepEqual(identifier, { handle: "tee" });
  assert.equal(input.id, undefined); // handle identifiers don't set input.id
});

test("validator: record-aware, keeps whole valid groups", () => {
  const { valid, errors } = validateProductRows(productGroup());
  assert.equal(errors.length, 0);
  assert.equal(valid.length, 2); // both rows of the product kept
});

test("validator: create with no title and no identity is rejected", () => {
  const [top, second] = productGroup();
  const { errors } = validateProductRows([{ ...top, title: "", product_id: "", handle: "" }, second]);
  assert.ok(errors.some((e) => e.field === "title"));
});

test("validator: DELETE without id or handle is rejected", () => {
  const { errors } = validateProductRows([
    { top_row: "TRUE", command: "DELETE", product_id: "", handle: "" },
  ]);
  assert.ok(errors.some((e) => e.message.includes("DELETE")));
});

test("validator: non-numeric price is rejected", () => {
  const [top, second] = productGroup();
  const { errors } = validateProductRows([{ ...top, price: "abc" }, second]);
  assert.ok(errors.some((e) => e.field === "price"));
});

test("full round-trip: export rows → CSV → parse → normalize → validate → build", () => {
  const columns = [...PRODUCT_FIELDS, MF_PRODUCT, MF_VARIANT];
  const csv = toCSV(productGroup(), columns);          // humanized headers
  const parsed = parseCSV(csv);
  const rows = normalizeHeaders(parsed, "products");   // back to snake_case keys

  const { valid, errors } = validateProductRows(rows);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(valid.length, 2);

  const groups = groupRecords(valid);
  assert.equal(groups.length, 1);
  const { input } = buildProductSetInput(groups[0]);
  assert.equal(input.variants.length, 2);
  assert.equal(input.title, "Tee");
  assert.equal(input.metafields[0].key, "care");
});
