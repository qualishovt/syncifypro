/**
 * components/JobKindIcons.jsx
 *
 * The Export/Import glyphs in their brand colors, shared by the home page
 * cards and the run page's kind badge.
 */

// Export = data leaving the store — green upload-from-tray arrow. A plain SVG
// (not s-icon) so it sizes with its context exactly like ImportIcon; #008060
// is Shopify's success green.
/* eslint-disable react/prop-types */
export function ExportIcon({ color }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: "1em", height: "1em" }} fill="none" stroke={color ?? "#008060"} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 8 12 3 17 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

// Import = data coming into the store — blue download-into-tray arrow.
// `color` overrides the brand blue (e.g. "currentColor" inside a primary button).
export function ImportIcon({ color }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: "1em", height: "1em" }} fill="none" stroke={color ?? "#2c6ecb"} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
/* eslint-enable react/prop-types */
