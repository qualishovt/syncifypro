/**
 * components/FormatIcon.jsx
 *
 * One icon per export format, shared by the Export page's Format picker and
 * the run page's status row. Excel gets an outlined sheet with an X, JSON
 * gets literal curly braces — neither exists in the Polaris set, so both are
 * tiny inline SVGs in currentColor, sized to sit beside s-icon glyphs.
 */

// Polaris tokens for the formats the set can represent; the rest are drawn.
const FORMAT_ICONS = {
  csv: "data-table",   // plain rows and columns
  xml: "code",
  pdf: "file",         // a document to read, not to parse
};

/* eslint-disable react/prop-types */
export default function FormatIcon({ format }) {
  if (format === "excel") {
    // Folded-corner file with an X — reads as "Excel file" even at 16px.
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: "none" }}>
        <path d="M3 1.5h6.5L13 5v9.5H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M5.6 7.5 10.4 12.5 M10.4 7.5 5.6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (format === "json") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
        <text
          x="8" y="12.5" textAnchor="middle"
          fontSize="12" fontWeight="700"
          fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
          fill="currentColor"
        >
          {"{}"}
        </text>
      </svg>
    );
  }
  if (format === "google_feed") {
    // A ringed G — Google without the brand colors.
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: "none" }}>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4" />
        <text
          x="8.2" y="11" textAnchor="middle"
          fontSize="8.5" fontWeight="700" fontFamily="inherit"
          fill="currentColor"
        >
          G
        </text>
      </svg>
    );
  }
  if (format === "csv_shopify") {
    // Shopify's shopping bag with the S, monochrome like the rest.
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flex: "none" }}>
        <path
          d="M3.5 5h9l.8 8.2a1 1 0 0 1-1 1.1H3.7a1 1 0 0 1-1-1.1z"
          stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
        />
        <path d="M5.8 5V4a2.2 2.2 0 0 1 4.4 0v1" stroke="currentColor" strokeWidth="1.4" />
        <text
          x="8" y="12" textAnchor="middle"
          fontSize="6.5" fontWeight="700" fontFamily="inherit"
          fill="currentColor"
        >
          S
        </text>
      </svg>
    );
  }
  const token = FORMAT_ICONS[format];
  return token ? <s-icon type={token} /> : null;
}
/* eslint-enable react/prop-types */
