import React from "react";
import AppSelect from "./AppSelect";

/**
 * Form dropdown used across the Milik add/edit forms. Every dropdown here is searchable.
 * items + getLabel/getValue map any list of records onto AppSelect options.
 */
const MilikSelect = ({
  label,
  required = false,
  placeholder = "Select…",
  items = [],
  value,
  onChange,
  getLabel = (x) => x,
  getValue = (x) => x,
  disabled = false,
  error = "",
  allowClear = false,
  className = "",
}) => (
  <AppSelect
    label={label}
    required={required}
    placeholder={placeholder}
    options={items.map((it) => ({ value: getValue(it), label: getLabel(it) }))}
    value={value}
    onChange={(v) => onChange?.(v ?? "", items.find((it) => getValue(it) === v) ?? null)}
    searchable
    clearable={allowClear}
    disabled={disabled}
    error={error}
    className={className}
    size="md"
  />
);

export default MilikSelect;
