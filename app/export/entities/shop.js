/**
 * export/entities/shop.js
 *
 * Fetches the single Shop record as one normalized flat row. The shop is a
 * singleton, so there's no pagination, filtering, count, or bulk path.
 */

import { normalizeShop } from "../normalizer.js";

const SHOP_QUERY = `#graphql
  query GetShop {
    shop {
      id name email contactEmail myshopifyDomain
      url currencyCode ianaTimezone weightUnit
      primaryDomain { host url }
      shopAddress { address1 address2 city province provinceCode zip country countryCodeV2 phone }
      plan { publicDisplayName partnerDevelopment shopifyPlus }
      createdAt updatedAt
    }
  }
`;

export async function extractShop(admin) {
  const response = await admin.graphql(SHOP_QUERY);
  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`Shopify API error: ${errors.map((e) => e.message).join(", ")}`);
  }
  return [normalizeShop(data.shop)];
}
