/**
 * components/PolarisPasswordField.jsx
 *
 * Thin wrapper over the Polaris <s-password-field> web component, with the
 * same native-event bridging as PolarisTextField (React 18 doesn't attach
 * on* handlers to custom-element events).
 */

import { useEffect, useRef } from "react";

/* eslint-disable react/prop-types */
export default function PolarisPasswordField({ label, value, onChange, placeholder, disabled }) {
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
    <s-password-field
      ref={ref}
      label={label}
      {...(placeholder ? { placeholder } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}
/* eslint-enable react/prop-types */
