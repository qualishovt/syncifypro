/**
 * components/MultiFilter.jsx
 *
 * A filter that takes SEVERAL values at once (Matrixify's "State: Cancelled,
 * Finished"): a trigger summarising the selection, and a popover of
 * checkboxes that stays open while they are ticked — one round trip per
 * choice would make picking three statuses feel like three page loads.
 *
 * Selection is a plain array of values, owned by the caller; this component
 * only decides how it looks and how a row toggles.
 */

import PolarisCheckbox from "./PolarisCheckbox.jsx";
import { useElementWidth, widthProps } from "./PickerPopover.jsx";

/** "Products, Collections +2 more" — a summary that can't grow the control. */
export function summarise(selected, options, allLabel, max = 2) {
  if (!selected.length) return allLabel;
  const labels = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const shown = labels.slice(0, max).join(", ");
  return labels.length > max ? `${shown} +${labels.length - max} more` : shown;
}

/* eslint-disable react/prop-types */
export default function MultiFilter({ id, label, allLabel, options, selected, onChange }) {
  const [triggerRef, triggerWidth] = useElementWidth();
  const active = selected.length > 0;

  const toggle = (value) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div>
      <div ref={triggerRef}>
        <s-clickable
          command="--toggle"
          commandFor={id}
          accessibilityLabel={`${label} filter`}
          borderWidth="base"
          borderStyle="solid"
          borderColor={active ? "strong" : "base"}
          borderRadius="base"
          paddingInline="small-100"
          blockSize="32px"
          background="base"
        >
          <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
            <span style={{ whiteSpace: "nowrap" }}>
              {active ? `${label}: ${summarise(selected, options, allLabel)}` : allLabel}
            </span>
            <s-icon type="select" />
          </s-grid>
        </s-clickable>
      </div>
      <s-popover id={id} {...widthProps(Math.max(triggerWidth, 240))}>
        <s-box padding="small-200">
          <s-stack direction="block" gap="small-300">
            {options.map((o) => (
              <PolarisCheckbox
                key={o.value}
                label={o.label}
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
            ))}
            {active && (
              <s-button variant="tertiary" onClick={() => onChange([])}>Clear</s-button>
            )}
          </s-stack>
        </s-box>
      </s-popover>
    </div>
  );
}
/* eslint-enable react/prop-types */
