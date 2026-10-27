import React from "react";
import { FaPlus, FaTrash } from "react-icons/fa";
import { fmtKES, todayISO } from "../../services/propertySaleApi";
import CurrencyInput from "../../components/common/CurrencyInput";

// Shared between the plain "New Deal" form (SaleDeals.jsx) and "Convert Offer to Deal" (SaleOffers.jsx) —
// both let the same payment-plan-aware schedule preview be built at the same moment the deal itself is
// created, instead of a disconnected second visit to the Schedule tab afterward.
export const labelClass = "mb-1 block text-xs font-bold text-slate-900";
export const inputClass = "h-7 w-full border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The four standard ways property is bought in Kenya — outright cash closes fast with no drawn-out
// timeline to project, so it's the one plan that doesn't ask for an Expected Closing Date at all.
export const PAYMENT_PLANS = ["cash", "installment", "mortgage", "off_plan"];
export const PAYMENT_PLAN_LABEL = { cash: "Cash (Outright)", installment: "Installment Plan", mortgage: "Mortgage / Bank Financing", off_plan: "Off-Plan (Pre-Construction)" };
export const PAYMENT_PLAN_OPTIONS = PAYMENT_PLANS.map((p) => ({ value: p, label: PAYMENT_PLAN_LABEL[p] }));

export const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3 };
export const FREQUENCY_OPTIONS = [{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }];
export const DEPOSIT_MODE_OPTIONS = [{ value: "percent", label: "%" }, { value: "flat", label: "KES" }];

// Ephemeral generator-input defaults — spread into any form's blank state. Never sent to the API as-is;
// the caller strips these before building its create/update payload (only the resulting scheduleRows,
// saved separately via setSchedule once the deal's id exists, actually persists).
export const blankScheduleGeneratorFields = {
  depositMode: "percent", depositValue: "", installmentCount: "", frequency: "monthly", firstInstallmentDate: "",
  scheduleRows: [],
};

// Deposit (due on the deal date) + N equal installments after it, due `frequency` months apart starting
// at firstInstallmentDate. Uses the same "target minus already allocated" incremental rounding math as
// WHT splits and tier releases elsewhere in this app, so the rows always sum to exactly agreedPrice —
// the last installment silently absorbs any stray cent instead of risking a mismatch setSchedule would reject.
export const generateScheduleRows = ({ agreedPrice, dealDate, depositMode, depositValue, installmentCount, frequency, firstInstallmentDate }) => {
  const price = Number(agreedPrice) || 0;
  const count = Math.max(0, Math.floor(Number(installmentCount) || 0));
  if (price <= 0 || count <= 0 || !firstInstallmentDate) return [];

  const deposit = round2(depositMode === "percent" ? (price * (Number(depositValue) || 0)) / 100 : Number(depositValue) || 0);
  const remaining = round2(price - deposit);
  if (remaining < 0) return [];

  const rows = [];
  if (deposit > 0) rows.push({ dueDate: dealDate || todayISO(), expectedAmount: deposit, description: "Deposit" });

  const monthsStep = FREQUENCY_MONTHS[frequency] || 1;
  let allocated = 0;
  for (let i = 1; i <= count; i++) {
    const target = round2(remaining * (i / count));
    const amount = round2(target - allocated);
    allocated = round2(allocated + amount);
    const due = new Date(firstInstallmentDate);
    due.setMonth(due.getMonth() + monthsStep * (i - 1));
    rows.push({ dueDate: due.toISOString().split("T")[0], expectedAmount: amount, description: `Installment ${i}` });
  }
  return rows;
};

// Compact, editable rows (one header row, thin h-7 input rows) — a generated even-split rarely matches a
// real negotiated schedule exactly, so every row stays editable and rows can be added/removed freely.
export function ScheduleRowsEditor({ items, setItems, agreedPrice }) {
  const total = items.reduce((s, i) => s + Number(i.expectedAmount || 0), 0);
  return (
    <div>
      <div className="max-h-64 overflow-y-auto border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-100">
            <tr className="text-left text-[9px] font-black uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1.5 w-36">Due Date</th>
              <th className="px-2 py-1.5 w-32">Amount (KES)</th>
              <th className="px-2 py-1.5">Description</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-1">
                  <input type="date" value={item.dueDate} onChange={(e) => setItems((prev) => prev.map((x, i) => i === idx ? { ...x, dueDate: e.target.value } : x))} className={`${inputClass} font-normal`} />
                </td>
                <td className="px-2 py-1">
                  <CurrencyInput prefix={null} value={item.expectedAmount} onChange={(e) => setItems((prev) => prev.map((x, i) => i === idx ? { ...x, expectedAmount: e.target.value } : x))} inputClassName={`${inputClass} font-mono font-normal`} />
                </td>
                <td className="px-2 py-1">
                  <input type="text" value={item.description} onChange={(e) => setItems((prev) => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className={`${inputClass} font-normal`} placeholder={`Installment ${idx + 1}`} />
                </td>
                <td className="px-2 py-1">
                  <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} className="flex h-7 w-7 items-center justify-center border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100">
                    <FaTrash size={8} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <button type="button" onClick={() => setItems((prev) => [...prev, { dueDate: "", expectedAmount: "", description: `Installment ${prev.length + 1}` }])} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-[#F1F6F3] px-2.5 py-1 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/40">
          <FaPlus size={7} /> Add Installment
        </button>
        {items.length > 0 && (
          <div className="text-[10px]">
            <span className="text-slate-500">Total: </span>
            <span className={`font-black ${Math.abs(total - agreedPrice) < 1 ? "text-emerald-700" : "text-rose-600"}`}>
              {fmtKES(total)}
            </span>
            <span className="text-slate-400"> / {fmtKES(agreedPrice)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// The full inline generator block — deposit mode toggle, count/frequency/first-due inputs, Generate
// button, and the row editor once rows exist. `onFieldChange(patch)` is the caller's own
// updateScheduleInput-style handler so the "ask before regenerating over manual edits" behavior stays
// identical on both pages that use this.
export function SchedulePreviewSection({ form, onFieldChange, onGenerate, setScheduleRows }) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Payment Schedule</div>
      <div className="grid items-end gap-3 sm:grid-cols-5">
        <div>
          <label className={labelClass}>Deposit</label>
          <div className="flex gap-1">
            {form.depositMode === "percent" ? (
              <input type="number" min="0" value={form.depositValue} onChange={(e) => onFieldChange({ depositValue: e.target.value })} className={inputClass} placeholder="e.g. 25" />
            ) : (
              <CurrencyInput value={form.depositValue} onChange={(e) => onFieldChange({ depositValue: e.target.value })} inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} placeholder="2,000,000.00" />
            )}
            <div className="flex shrink-0 border border-slate-200 bg-white">
              {DEPOSIT_MODE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onFieldChange({ depositMode: o.value })}
                  className={`px-2 text-[10px] font-black ${form.depositMode === o.value ? "bg-[#0B3B2E] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {form.depositMode === "percent" && Number(form.depositValue) > 0 && Number(form.agreedPrice) > 0 && (
            <p className="mt-1 text-[10px] text-slate-500">= {fmtKES(round2((Number(form.agreedPrice) * Number(form.depositValue)) / 100))}</p>
          )}
        </div>
        <div>
          <label className={labelClass}># of Installments</label>
          <input type="number" min="0" value={form.installmentCount} onChange={(e) => onFieldChange({ installmentCount: e.target.value })} className={inputClass} placeholder="e.g. 12" />
        </div>
        <div>
          <label className={labelClass}>Frequency</label>
          <select value={form.frequency} onChange={(e) => onFieldChange({ frequency: e.target.value })} className={inputClass}>
            {FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>First Installment Due</label>
          <input type="date" value={form.firstInstallmentDate} onChange={(e) => onFieldChange({ firstInstallmentDate: e.target.value })} className={inputClass} />
        </div>
        <div>
          <button type="button" onClick={onGenerate} className="h-7 w-full border border-[#B7C9C0] bg-[#F1F6F3] text-xs font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/40">
            Generate
          </button>
        </div>
      </div>
      {form.scheduleRows.length > 0 && (
        <div className="mt-2.5">
          <ScheduleRowsEditor items={form.scheduleRows} setItems={setScheduleRows} agreedPrice={Number(form.agreedPrice) || 0} />
        </div>
      )}
    </div>
  );
}
