import React from "react";
import AppSelect from "../../components/common/AppSelect";

// Local override, not the shared utils/formStyles.js — see SaleListingFormModal.jsx for why.
const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "w-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

// One extra field of a property type (Sale Settings), rendered by its kind: text, number, list, date or yes/no.
// `onChange(key, value)`; the value is stored under the field's stable key in the listing's `attributes`.
const SaleCustomField = React.memo(function SaleCustomField({ field, value, onChange }) {
  const label = field.label;

  if (field.kind === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-2 pt-5">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(field.key, e.target.checked)} className="accent-[#0B3B2E]" />
        <span className="text-xs font-semibold text-slate-700">{label}{field.required && <Required />}</span>
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <div>
        <AppSelect
          label={label}
          required={field.required}
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
      <label className={labelClass}>{label}{field.required && <Required />}</label>
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
