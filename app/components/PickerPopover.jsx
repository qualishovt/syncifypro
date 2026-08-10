/**
 * components/PickerPopover.jsx
 *
 * Shared pieces of the app's popover-dropdown pattern (the run page's
 * Deliver-to picker, the scheduler's server/format pickers, the home page's
 * server picker): a trigger measured so the popover matches its width, and
 * check-marked option rows.
 */

import { useEffect, useState } from "react";

/** Measure an element's width (for popovers matched to their trigger). */
export function useElementWidth() {
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

export function widthProps(w) {
  if (!w) return {};
  return { inlineSize: `${w}px`, minInlineSize: `${w}px`, maxInlineSize: `${w}px` };
}

// Reserved left column in picker rows so the checkmark aligns all labels.
const checkSlot = {
  width: 20, display: "inline-flex", alignItems: "center", justifyContent: "center",
};

/* eslint-disable react/prop-types */
/** Row inside a picker popover: check slot → optional icon → label. */
export function PickerRow({ label, icon, selected, onSelect, popoverId }) {
  return (
    <s-clickable
      onClick={onSelect}
      command="--hide"
      commandFor={popoverId}
      padding="small-200"
      borderRadius="base"
      {...(selected ? { background: "subdued" } : {})}
    >
      <s-grid gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
        <span style={checkSlot}>{selected ? <s-icon type="check" /> : null}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", ...(selected ? { fontWeight: 700 } : null) }}>
          {icon}
          {label}
        </span>
      </s-grid>
    </s-clickable>
  );
}
/* eslint-enable react/prop-types */
