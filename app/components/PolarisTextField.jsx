/**
 * components/PolarisTextField.jsx
 *
 * Thin wrapper over the Polaris <s-text-field> web component. React's
 * synthetic onChange doesn't bind reliably to custom-element form controls,
 * so native input/change listeners are attached via a ref and the value is
 * pushed back imperatively (only when it differs, to avoid clobbering the
 * caret) — same bridging as PolarisSelect.
 */

import { useEffect, useRef } from "react";

/* eslint-disable react/prop-types */
export default function PolarisTextField({ label, value, onChange, onEnter, placeholder, disabled, labelAccessibilityVisibility }) {
  const ref = useRef(null);
  const changeCb = useRef(onChange);
  changeCb.current = onChange;
  const enterCb = useRef(onEnter);
  enterCb.current = onEnter;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => changeCb.current?.(e.target.value);
    const keyHandler = (e) => { if (e.key === "Enter") enterCb.current?.(); };
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    el.addEventListener("keydown", keyHandler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
      el.removeEventListener("keydown", keyHandler);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== (value ?? "")) el.value = value ?? "";
  }, [value]);

  return (
    <s-text-field
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(placeholder ? { placeholder } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}
/* eslint-enable react/prop-types */
