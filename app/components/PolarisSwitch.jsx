/**
 * components/PolarisSwitch.jsx
 *
 * Thin wrapper over the Polaris <s-switch> web component, bridged like
 * PolarisCheckbox (native change listener via a ref).
 */

import { useEffect, useRef } from "react";

/* eslint-disable react/prop-types */
export default function PolarisSwitch({ label, checked, onChange, disabled }) {
  const ref = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => cb.current?.(Boolean(e.target.checked));
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && Boolean(el.checked) !== Boolean(checked)) el.checked = Boolean(checked);
  }, [checked]);
  return (
    <s-switch
      ref={ref}
      label={label}
      checked={checked ? true : undefined}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}
/* eslint-enable react/prop-types */
