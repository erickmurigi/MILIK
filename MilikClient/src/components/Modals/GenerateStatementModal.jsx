import React, { useState } from "react";
import { FaTimes, FaCalendarAlt } from "react-icons/fa";
import { useTerms } from "../../hooks/useTerm";

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-slate-700 bg-[#0B3B2E] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <FaCalendarAlt className="text-emerald-400" />
            <h2 className="text-sm font-black uppercase tracking-wide">Generate Draft Statement</h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <FaTimes size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {[
              { label: termProperty, key: "propertyId", type: "select", options: properties.map((p) => ({ value: p._id, label: p.propertyName || p.name || "Unnamed" })) },
              { label: termLandlord, key: "landlordId", type: "select", options: landlords.map((l) => ({ value: l._id, label: `${l.firstName} ${l.lastName}` })) },
            ].map(({ label, key, options }) => (
              <div key={key}>
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">{label} <span className="text-red-500">*</span></label>
                <select value={formData[key]} onChange={(e) => set(key, e.target.value)} className={inputCls(key)}>
                  <option value="">Select {label.toLowerCase()}…</option>
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {errors[key] && <p className="text-red-600 text-xs mt-1">{errors[key]}</p>}
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              {[["Start Date", "periodStart"], ["End Date", "periodEnd"]].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">{label} <span className="text-red-500">*</span></label>
                  <input type="date" value={formData[key]} onChange={(e) => set(key, e.target.value)} className={inputCls(key)} />
                  {errors[key] && <p className="text-red-600 text-xs mt-1">{errors[key]}</p>}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1.5">Notes (Optional)</label>
              <textarea value={formData.notes} onChange={(e) => set("notes", e.target.value)} rows={3}
                placeholder="Add any notes…"
                className="w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E] resize-none" />
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button type="button" onClick={onClose} disabled={loading}
              className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-50">
              <FaCalendarAlt size={11} /> {loading ? "Generating…" : "Generate Statement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GenerateStatementModal;
