import React, { useState } from "react";
import { FaCalendarAlt } from "react-icons/fa";
import { useTerms } from "../../hooks/useTerm";
import Modal from "../common/Modal";
import FormField from "../common/FormField";

const GenerateStatementModal = ({ isOpen, properties = [], landlords = [], onClose, onGenerateDraft, loading = false }) => {
  const { property: termProperty, landlord: termLandlord } = useTerms("property", "landlord");
  const [formData, setFormData] = useState({ propertyId: "", landlordId: "", periodStart: "", periodEnd: "", notes: "" });
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!formData.propertyId) e.propertyId = `${termProperty} is required`;
    if (!formData.landlordId) e.landlordId = `${termLandlord} is required`;
    if (!formData.periodStart) e.periodStart = "Start date is required";
    if (!formData.periodEnd) e.periodEnd = "End date is required";
    if (formData.periodStart && formData.periodEnd && new Date(formData.periodStart) >= new Date(formData.periodEnd))
      e.periodEnd = "End date must be after start date";
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    try {
      await onGenerateDraft(formData);
      setFormData({ propertyId: "", landlordId: "", periodStart: "", periodEnd: "", notes: "" });
      setErrors({});
      onClose();
    } catch (err) {
      console.error("Error generating statement:", err);
    }
  };

  const set = (k, v) => setFormData((p) => ({ ...p, [k]: v }));
  const inputCls = (key) => `w-full border px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] ${errors[key] ? "border-red-500" : "border-slate-300"}`;

  if (!isOpen) return null;

  return (
    <Modal
      title="Generate Draft Statement"
      icon={<FaCalendarAlt className="text-emerald-400" />}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
            Cancel
          </button>
          <button type="submit" form="generate-statement-form" disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-50">
            <FaCalendarAlt size={11} /> {loading ? "Generating…" : "Generate Statement"}
          </button>
        </>
      }
    >
      <form id="generate-statement-form" onSubmit={handleSubmit} className="space-y-4">
        {[
          { label: termProperty, key: "propertyId", options: properties.map((p) => ({ value: p._id, label: p.propertyName || p.name || "Unnamed" })) },
          { label: termLandlord, key: "landlordId", options: landlords.map((l) => ({ value: l._id, label: `${l.firstName} ${l.lastName}` })) },
        ].map(({ label, key, options }) => (
          <FormField key={key} label={label} required>
            <select value={formData[key]} onChange={(e) => set(key, e.target.value)} className={inputCls(key)}>
              <option value="">Select {label.toLowerCase()}…</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {errors[key] && <p className="text-red-600 text-xs mt-1">{errors[key]}</p>}
          </FormField>
        ))}

        <div className="grid grid-cols-2 gap-3">
          {[["Start Date", "periodStart"], ["End Date", "periodEnd"]].map(([label, key]) => (
            <FormField key={key} label={label} required>
              <input type="date" value={formData[key]} onChange={(e) => set(key, e.target.value)} className={inputCls(key)} />
              {errors[key] && <p className="text-red-600 text-xs mt-1">{errors[key]}</p>}
            </FormField>
          ))}
        </div>

        <FormField label="Notes (Optional)">
          <textarea value={formData.notes} onChange={(e) => set("notes", e.target.value)} rows={3}
            placeholder="Add any notes…"
            className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none" />
        </FormField>
      </form>
    </Modal>
  );
};

export default GenerateStatementModal;
