/**
 * utils/stableJson.js
 *
 * JSON with object keys in a fixed order, used to tell whether a page still
 * holds what a preset put on it. Plain JSON.stringify would report a change
 * whenever the same settings were rebuilt in another order — which happens
 * constantly in React, where objects are recreated rather than mutated.
 *
 * `undefined` is written as null so an absent key and an explicitly-unset one
 * compare equal: a filter that was cleared reads the same as one never set.
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
