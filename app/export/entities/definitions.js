/**
 * export/entities/definitions.js
 *
 * Combined "Definitions" entity = metafield definitions + metaobject
 * definitions in one sheet, distinguished by a `kind` column. Each source
 * row is widened to the shared union shape (blank where N/A).
 */

import { extractMetafields } from "./metafields.js";
import { extractMetaobjectDefinitions } from "./metaobjectDefinitions.js";

// Union shape — also defines column order. Source rows are spread over this,
// so missing keys stay blank and the key order is stable.
const BLANK = {
  kind: "", definition_id: "", namespace: "", key: "", name: "", type: "",
  owner_type: "", description: "", validations: "", field_definitions: "",
  metafields_count: "", metaobjects_count: "",
};

export async function extractDefinitions(admin) {
  const metafieldDefs = (await extractMetafields(admin))
    .map((r) => ({ ...BLANK, ...r, kind: "metafield" }));
  const metaobjectDefs = (await extractMetaobjectDefinitions(admin))
    .map((r) => ({ ...BLANK, ...r, kind: "metaobject" }));
  return [...metafieldDefs, ...metaobjectDefs];
}
