import React from "react";

/**
 * Number input that displays formatted value with thousand separators (1,500,000)
 * while keeping the raw numeric string in form state.
 *
 * Props:
 *   value      – raw number or string (no commas)
 *   onChange   – called with raw numeric string (e.g. "1500000")
 *   className  – passed straight through to <input>
 *   ...rest    – any other <input> props (placeholder, required, min, etc.)
 */
const AmountInput = ({ value, onChange, className = "", ...rest }) => {
  const format = (v) => {
    const digits = String(v ?? "").replace(/[^0-9]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("en-KE");
  };

  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    onChange(raw);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={format(value)}
      onChange={handleChange}
      className={className}
      {...rest}
    />
  );
};

export default AmountInput;
