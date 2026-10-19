import React, { useState } from "react";
import { FaCalendarAlt, FaTimes } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import { useTerms } from "../../hooks/useTerm";

export const ACTIVITY_TYPES = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
export const OUTCOMES       = ["positive", "neutral", "negative", "no_answer", "not_applicable"];
export const ACTIVITY_TYPE_OPTIONS = ACTIVITY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }));
export const OUTCOME_OPTIONS       = OUTCOMES.map((o) => ({ value: o, label: o.replace(/_/g, " ") }));

export const blankActivityForm = {
  type: "call", subject: "", notes: "", date: "", durationMinutes: "", outcome: "not_applicable",
  nextAction: "", nextActionDate: "", relatedLead: "", relatedBuyer: "", relatedDeal: "",
};

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;
// font-bold matches labelClass's weight — the typed/selected value should read as prominently as its
// label, not lighter; placeholder text stays at the browser default so it still reads as "unset".
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";

/**
 * Shared Log/Edit Activity modal — used both by the general Activities page (where you pick which
 * lead/buyer/deal it's for) and by a lead's own detail panel (where that's already fixed, so the
 * link-to fields would be redundant). Pass `leadName` + omit `linkOptions` for the lead-scoped case;
 * pass `linkOptions` for the general case. One component instead of two near-identical copies that
 * would otherwise drift out of sync with each other (field sizing, labels, validation) over time.
 */
export default function SaleActivityFormModal({
  editingAct, initial, saving, leadName, linkOptions, onClose, onSubmit,
}) {
  const T = useTerms("saleLead", "saleBuyer", "saleDeal");
  const [form, setForm] = useState(initial);
  const showLinks = !!linkOptions;

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full flex-col bg-white shadow-2xl sm:max-w-lg sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white rounded-t-2xl sm:rounded-none">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
              <FaCalendarAlt />{editingAct ? "Edit Activity" : "Log Activity"}
            </h3>
            {leadName && <div className="text-[10px] text-white/60 mt-0.5">for {leadName}</div>}
          </div>
          <button onClick={onClose} className="p-1 text-white/70 hover:bg-white/10 hover:text-white"><FaTimes /></button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white px-5 py-4 grid grid-cols-2 gap-3">
          <div>
            <AppSelect label="Type" required value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v ?? "" }))} options={ACTIVITY_TYPE_OPTIONS} size="sm" />
          </div>
          <div>
            <label className={labelClass}>Date & Time<Required /></label>
            <input type="datetime-local" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Subject</label>
            <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} className={inputClass} placeholder={showLinks ? undefined : "e.g. Site visit — Westlands plot"} />
          </div>
          <div>
            <AppSelect label="Outcome" value={form.outcome} onChange={(v) => setForm((f) => ({ ...f, outcome: v ?? "" }))} options={OUTCOME_OPTIONS} size="sm" />
          </div>
          <div>
            <label className={labelClass}>Duration (min)</label>
            <input type="number" value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} className={inputClass} />
          </div>

          {showLinks && (
            <>
              <div>
                <AppSelect label={`Link to ${T.saleLead}`} value={form.relatedLead} onChange={(v) => setForm((f) => ({ ...f, relatedLead: v ?? "", relatedBuyer: "", relatedDeal: "" }))} options={linkOptions.leadOptions} placeholder="— None —" size="sm" searchable clearable />
              </div>
              <div>
                <AppSelect label={`Link to ${T.saleBuyer}`} value={form.relatedBuyer} onChange={(v) => setForm((f) => ({ ...f, relatedBuyer: v ?? "", relatedLead: "", relatedDeal: "" }))} options={linkOptions.buyerOptions} placeholder="— None —" size="sm" searchable clearable disabled={!!form.relatedLead} />
              </div>
              <div className="col-span-2">
                <AppSelect label={`Link to ${T.saleDeal}`} value={form.relatedDeal} onChange={(v) => setForm((f) => ({ ...f, relatedDeal: v ?? "", relatedLead: "", relatedBuyer: "" }))} options={linkOptions.dealOptions} placeholder="— None —" size="sm" searchable clearable disabled={!!(form.relatedLead || form.relatedBuyer)} />
              </div>
            </>
          )}

          <div className="col-span-2">
            <label className={labelClass}>Notes</label>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={`${inputClass} h-auto py-1.5 resize-none`} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Next Action</label>
            <input value={form.nextAction} onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value }))} className={inputClass} placeholder={showLinks ? undefined : "e.g. Send site plan brochure"} />
          </div>
          <div>
            <label className={labelClass}>Next Action Date</label>
            <input type="date" value={form.nextActionDate} onChange={(e) => setForm((f) => ({ ...f, nextActionDate: e.target.value }))} className={inputClass} />
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button onClick={onClose} className="h-8 border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSubmit(form)} disabled={saving} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-black text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving…" : editingAct ? "Update" : "Log Activity"}
          </button>
        </div>
      </div>
    </div>
  );
}
