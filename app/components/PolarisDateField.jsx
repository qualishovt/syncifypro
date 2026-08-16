/**
 * components/PolarisDateField.jsx
 *
 * Thin wrapper over the Polaris <s-date-field> web component (calendar picker
 * + manual entry), bridged like the other Polaris form controls.
 * `allow` restricts selectable dates ("YYYY-MM-DD--" = that day onward).
 */

import { useEffect, useRef } from "react";

/* eslint-disable react/prop-types */
export default function PolarisDateField({ label, value, onChange, disabled, allow, labelAccessibilityVisibility }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(e.target.value);
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== (value ?? "")) el.value = value ?? "";
  }, [value]);
  return (
    <s-date-field
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(allow ? { allow } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}
/* eslint-enable react/prop-types */
