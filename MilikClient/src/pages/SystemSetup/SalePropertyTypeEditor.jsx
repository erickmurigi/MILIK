import React from "react";
import { FaArrowDown, FaArrowUp, FaPlus, FaTimes } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import { inputClass } from "../../utils/formStyles";

const KIND_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "List of choices" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
];

// Standard listing fields a type can leave out
const HIDEABLE = [
  { key: "size", label: "Size" },
  { key: "location", label: "Location, town and county" },
  { key: "titleDeed", label: "Title deed" },
  { key: "amenities", label: "Amenities" },
];

const VEHICLE_TEMPLATE = {
  fields: [
    { label: "Registration No.", kind: "text", required: true },
    { label: "Make", kind: "text", required: true },
    { label: "Model", kind: "text" },
    { label: "Year", kind: "number" },
    { label: "Mileage (km)", kind: "number" },
    { label: "Engine CC", kind: "number" },
    { label: "Fuel", kind: "select", options: ["Petrol", "Diesel", "Hybrid", "Electric"] },
    { label: "Transmission", kind: "select", options: ["Manual", "Automatic"] },
    { label: "Colour", kind: "text" },
  ],
  hiddenFields: ["size", "titleDeed"],
};

const blankField = () => ({ label: "", kind: "text", options: [], required: false });

/**
 * Editor for one property type (Company Settings -> Property Sales -> Property Types): its name, the standard fields it
 * does not use, and its own extra fields. `formData` is `{ name, fields, hiddenFields }` and is saved as-is: existing
 * fields keep their `key`, which is what keeps stored values attached when a label is renamed.
 */
export default function SalePropertyTypeEditor({ formData, setFormData }) {
  const fields = formData.fields || [];
  const hidden = formData.hiddenFields || [];

  const setFields = (next) => setFormData((p) => ({ ...p, fields: next }));
  const patchField = (i, patch) => setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setFields(next);
  };
  const toggleHidden = (key) =>
    setFormData((p) => {
      const cur = p.hiddenFields || [];
      return { ...p, hiddenFields: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });

  const applyTemplate = () => setFormData((p) => ({ ...p, fields: VEHICLE_TEMPLATE.fields.map((f) => ({ options: [], required: false, ...f })), hiddenFields: VEHICLE_TEMPLATE.hiddenFields }));

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-700">Property Type *</label>
        <input
          className={inputClass}
          value={formData.name || ""}
          onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
          placeholder="e.g. Apartment, Vehicle"
        />
      </div>

      <div>
        <div className="mb-1 text-xs font-bold text-slate-700">Standard fields this type does not use</div>
        <p className="mb-2 text-[11px] text-slate-500">Ticked fields are left out of the form for this type (a vehicle has no title deed).</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {HIDEABLE.map((h) => (
            <label key={h.key} className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={hidden.includes(h.key)} onChange={() => toggleHidden(h.key)} className="accent-[#0B3B2E]" />
              {h.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-700">Extra fields for this type</div>
          <button type="button" onClick={applyTemplate} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            Use vehicle template
          </button>
        </div>
        <p className="mb-2 text-[11px] text-slate-500">
          Extra details asked for on every listing of this type, such as registration number, make and mileage. Renaming a field keeps the values already entered.
        </p>

        {fields.length === 0 ? (
          <p className="border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-[11px] text-slate-400">No extra fields yet.</p>
        ) : (
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.key || `new-${i}`} className="border border-slate-200 bg-slate-50/60 p-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_170px]">
                  <input className={inputClass} value={f.label || ""} onChange={(e) => patchField(i, { label: e.target.value })} placeholder="Field name, e.g. Mileage (km)" maxLength={40} />
                  <AppSelect value={f.kind || "text"} onChange={(v) => patchField(i, { kind: v ?? "text" })} options={KIND_OPTIONS} size="md" />
                </div>
                {f.kind === "select" && (
                  <input
                    className={`${inputClass} mt-2`}
                    value={f._optionsText ?? (f.options || []).join(", ")}
                    onChange={(e) => patchField(i, {
                      _optionsText: e.target.value,
                      options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                    })}
                    placeholder="Choices, separated by commas: Petrol, Diesel, Hybrid"
                  />
                )}
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-slate-600">
                    <input type="checkbox" checked={Boolean(f.required)} onChange={(e) => patchField(i, { required: e.target.checked })} className="accent-[#0B3B2E]" />
                    Required
                  </label>
                  <div className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="border border-slate-200 bg-white p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30" aria-label="Move up"><FaArrowUp size={9} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="border border-slate-200 bg-white p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30" aria-label="Move down"><FaArrowDown size={9} /></button>
                    <button type="button" onClick={() => setFields(fields.filter((_, idx) => idx !== i))} className="border border-red-200 bg-white p-1 text-red-500 hover:bg-red-50" aria-label="Remove field"><FaTimes size={9} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setFields([...fields, blankField()])}
          disabled={fields.length >= 20}
          className="mt-2 inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
        >
          <FaPlus size={9} /> Add field
        </button>
      </div>
    </div>
  );
}
