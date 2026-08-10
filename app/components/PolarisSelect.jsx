/**
 * components/PolarisSelect.jsx
 *
 * Thin wrapper over the Polaris <s-select> web component that bridges its native
 * `change` event to a React `onChange(value)` callback. React 18 doesn't attach
 * on* handlers to custom-element events, so we listen via a ref instead. Pass
 * <s-option> children.
 */

import { useEffect, useRef } from "react";

/* eslint-disable react/prop-types */
export default function PolarisSelect({ value, onChange, label, disabled, placeholder, labelAccessibilityVisibility, children }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(e.target.value);
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, []);

  // React 18 only sets the `value` ATTRIBUTE on a custom element, but s-select
  // reads the `value` PROPERTY — so drive the property directly to keep the
  // control showing the right selection (after the options have rendered).
  useEffect(() => {
    const el = ref.current;
    if (el && value != null && el.value !== value) el.value = value;
  }, [value, children]);

  return (
    <s-select
      ref={ref}
      label={label}
      value={value}
      disabled={disabled ? true : undefined}
      {...(placeholder ? { placeholder } : {})}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
    >
      {children}
    </s-select>
  );
}
/* eslint-enable react/prop-types */
