/**
 * components/PolarisCheckbox.jsx
 *
 * Thin wrapper over the Polaris <s-checkbox> web component that bridges its
 * native `change` event to a React `onChange(checked)` callback. React 18's
 * synthetic-event delegation can drop change events on custom-element form
 * controls, so we wire the listener directly to the element via a ref (the same
 * reason PolarisSelect exists).
 */

import { useEffect, useRef } from "react";

/* eslint-disable react/prop-types */
export default function PolarisCheckbox({ label, checked, onChange, disabled, labelAccessibilityVisibility, indeterminate }) {
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

  // Boolean attrs on custom elements must be present-or-absent; passing
  // `checked={false}` would still leave a string attribute that reads truthy.
  return (
    <s-checkbox
      ref={ref}
      label={label}
      {...(labelAccessibilityVisibility ? { labelAccessibilityVisibility } : {})}
      {...(checked ? { checked: true } : {})}
      {...(indeterminate ? { indeterminate: true } : {})}
      {...(disabled ? { disabled: true } : {})}
    />
  );
}
/* eslint-enable react/prop-types */
