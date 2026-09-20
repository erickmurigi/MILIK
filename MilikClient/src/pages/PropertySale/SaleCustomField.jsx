import React from "react";
import AppSelect from "../../components/common/AppSelect";
import { inputClass, labelClass } from "../../utils/formStyles";

// One extra field of a property type (Sale Settings), rendered by its kind: text, number, list, date or yes/no.
// `onChange(key, value)`; the value is stored under the field's stable key in the listing's `attributes`.
const SaleCustomField = React.memo(function SaleCustomField({ field, value, onChange }) {
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (field.kind === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-2 pt-5">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(field.key, e.target.checked)} className="accent-[#0B3B2E]" />
        <span className="text-xs font-semibold text-slate-700">{label}</span>
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <div>
        <AppSelect
          label={label}
          value={value ?? ""}
          onChange={(v) => onChange(field.key, v ?? "")}
          options={(field.options || []).map((o) => ({ value: o, label: o }))}
          placeholder="Select…"
          size="md"
          clearable
        />
      </div>
    );
  }
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
        value={value ?? ""}
        onChange={(e) => onChange(field.key, e.target.value)}
        className={inputClass}
        maxLength={field.kind === "text" ? 200 : undefined}
      />
    </div>
  );
});

export default SaleCustomField;
