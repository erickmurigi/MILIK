import React, { useState } from "react";
import { toast } from "react-toastify";
import Modal from "../../components/common/Modal";
import AppSelect from "../../components/common/AppSelect";
import AmountInput from "./AmountInput";
import { fmtKES } from "../../services/propertySaleApi";
import { useTerms, prefixedTerm } from "../../hooks/useTerm";
import { useConfirm } from "../../context/ConfirmContext";
import {
  labelClass, inputClass, round2, PAYMENT_PLAN_OPTIONS, FREQUENCY_OPTIONS, DEPOSIT_MODE_OPTIONS,
  generateScheduleRows, ScheduleRowsEditor,
} from "./SaleScheduleGenerator";

const textareaClass = "w-full border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const COMMISSION_TYPE_OPTIONS = [{ value: "percentage", label: "Percentage (%)" }, { value: "flat", label: "Flat Amount (KES)" }];

// The one "new/edit deal" form, used both from the Deals page directly and from Offers' "Convert to
// Deal" action — `offer` (optional) is the only thing that distinguishes the two: when present, the
// listing/buyer are shown read-only (already fixed by the offer) instead of pickers, the
// asking/offered/agreed comparison shows at the top, and the title/submit wording follow the offer
// instead of a blank new deal. Everything else — payment plan, schedule generator, commission
// override — behaves identically either way, since both are still "create a new deal" (editingId is
// empty for both), just seeded with different `initial` values by the caller.
export default function DealFormModal({ editingId, initial, offer, saving, listingFormOptions, buyerOptions, agentFormOptions, agents, advocateFormOptions, onClose, onSubmit }) {
  const T = useTerms("saleOffer", "saleDeal", "saleListing", "saleBuyer", "saleAgent", "saleAdvocate");
  const confirm = useConfirm();
  const [form, setForm] = useState(initial);

  // A deposit/count/frequency/first-due-date edit, made AFTER a schedule already exists, asks before
  // touching it — silently regenerating would wipe any rows the user has since hand-edited, and silently
  // doing nothing would leave the schedule quietly out of sync with what's now on screen. The field's own
  // raw value always updates either way; only the generated rows are gated behind the prompt.
  const updateScheduleInput = async (patch) => {
    setForm((p) => ({ ...p, ...patch }));
    if (!form.scheduleRows.length) return;
    const ok = await confirm({
      title: "Update Installment Schedule?",
      message: "This changes a schedule input. Regenerate the installment rows from the new values? Any manual edits already made to individual rows will be replaced.",
      confirmText: "Regenerate",
      cancelText: "Keep Current Rows",
    });
    if (!ok) return;
    const next = { ...form, ...patch };
    const rows = generateScheduleRows({
      agreedPrice: next.agreedPrice, dealDate: next.dealDate, depositMode: next.depositMode,
      depositValue: next.depositValue, installmentCount: next.installmentCount,
      frequency: next.frequency, firstInstallmentDate: next.firstInstallmentDate,
    });
    setForm((p) => ({ ...p, scheduleRows: rows, expectedClosingDate: rows.length ? rows[rows.length - 1].dueDate : p.expectedClosingDate }));
  };

  const title = editingId ? `Edit ${T.saleDeal}` : offer ? `Convert ${T.saleOffer} to ${T.saleDeal}` : `New ${prefixedTerm("Sale", T.saleDeal, "saleDeal")}`;

  return (
    <Modal
      title={title}
      extraWide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : editingId ? `Update ${T.saleDeal}` : `Create ${T.saleDeal}`}
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        {offer && (
          <div className="md:col-span-3 grid grid-cols-3 gap-2 border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Asking</div>
              <div className="font-black text-emerald-900">{fmtKES(offer.listing?.askingPrice)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500">{T.saleBuyer} Offered</div>
              <div className="font-black text-emerald-900">{fmtKES(offer.offerAmount)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-500">{offer.counterOfferAmount ? "Countered At" : "Agreed"}</div>
              <div className="font-black text-emerald-900">{fmtKES(offer.counterOfferAmount || offer.offerAmount)}</div>
            </div>
          </div>
        )}
        <div>
          <label className={labelClass}>{T.saleListing} / Property</label>
          {offer ? (
            <div className={`${inputClass} flex items-center truncate bg-slate-50 text-slate-600`}>{offer.listing?.title || offer.listing?.listingNumber || "—"}</div>
          ) : (
            <AppSelect
              value={form.listing}
              onChange={(v) => setForm((p) => {
                // Prefill the listing's effective advocate (its own, else its project's) — but only
                // when the advocate field is still empty, so a manual override is never clobbered by
                // picking a different listing afterwards.
                const suggested = listingFormOptions.find((o) => o.value === v)?.advocate;
                const usable = suggested && advocateFormOptions.some((o) => o.value === suggested);
                return { ...p, listing: v ?? "", ...(!p.advocate && usable && { advocate: suggested }) };
              })}
              options={listingFormOptions}
              placeholder={`Select ${T.saleListing.toLowerCase()}…`}
              size="sm" searchable
            />
          )}
        </div>
        <div>
          <label className={labelClass}>{T.saleBuyer}</label>
          {offer ? (
            <div className={`${inputClass} flex items-center truncate bg-slate-50 text-slate-600`}>{offer.buyer?.fullName || "—"}</div>
          ) : (
            <AppSelect value={form.buyer} onChange={(v) => setForm((p) => ({ ...p, buyer: v ?? "" }))} options={buyerOptions} placeholder={`Select ${T.saleBuyer.toLowerCase()}…`} size="sm" searchable />
          )}
        </div>
        <div>
          <AppSelect label={`${prefixedTerm("Sales", T.saleAgent, "saleAgent")} (Optional)`} value={form.agent} onChange={(v) => setForm((p) => ({ ...p, agent: v ?? "", commOverrideEnabled: false, commissionRateOverride: "", commissionTypeOverride: "", commissionAmountOverride: "" }))} options={agentFormOptions} placeholder={`No ${T.saleAgent.toLowerCase()}`} size="sm" searchable clearable />
          {!editingId && form.agent && (() => {
            const selAgent = agents.find((a) => a._id === form.agent);
            return (
              <label className="mt-1 flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={!!form.commOverrideEnabled} onChange={(e) => setForm((p) => ({ ...p, commOverrideEnabled: e.target.checked }))} className="h-3 w-3 accent-[#0B3B2E]" />
                <span className="text-[10px] font-bold text-slate-500">
                  Override commission{selAgent && !form.commOverrideEnabled ? ` (default ${selAgent.commissionType === "percentage" ? `${selAgent.commissionRate}%` : `KES ${Number(selAgent.commissionRate).toLocaleString()}`})` : ""}
                </span>
              </label>
            );
          })()}
        </div>
        {!editingId && form.agent && form.commOverrideEnabled && (() => {
          const selAgent = agents.find((a) => a._id === form.agent);
          return (
            <div className="md:col-span-3 border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <AppSelect label="Commission Type" value={form.commissionTypeOverride || selAgent?.commissionType || "percentage"} onChange={(v) => setForm((p) => ({ ...p, commissionTypeOverride: v ?? "", commissionAmountOverride: "" }))} options={COMMISSION_TYPE_OPTIONS} size="sm" />
                </div>
                <div>
                  <label className={labelClass}>{(form.commissionTypeOverride || selAgent?.commissionType) === "flat" ? "Commission Amount (KES)" : "Commission Rate (%)"}</label>
                  <input type="number" min="0" step="0.01" value={form.commissionRateOverride} onChange={(e) => setForm((p) => ({ ...p, commissionRateOverride: e.target.value, commissionAmountOverride: "" }))} className={inputClass} placeholder={selAgent ? String(selAgent.commissionRate) : ""} />
                </div>
                <div>
                  <label className={labelClass}>Direct Amount Override (KES)</label>
                  <input type="number" min="0" step="0.01" value={form.commissionAmountOverride} onChange={(e) => setForm((p) => ({ ...p, commissionAmountOverride: e.target.value }))} className={inputClass} placeholder="Skip rate — set exact amount" />
                </div>
              </div>
            </div>
          );
        })()}
        <div>
          <AppSelect
            label={`${T.saleAdvocate} (Optional)`}
            value={form.advocate}
            onChange={(v) => setForm((p) => ({ ...p, advocate: v ?? "" }))}
            options={advocateFormOptions}
            placeholder={`Default (project/listing)`}
            size="sm" searchable clearable
          />
          <p className="mt-1 text-[10px] text-slate-400">Only set this to override the {T.saleListing.toLowerCase()}'s usual conveyancing {T.saleAdvocate.toLowerCase()} — e.g. the {T.saleBuyer.toLowerCase()} is using their own.</p>
        </div>
        <div>
          <label className={labelClass}>Agreed Price (KES)</label>
          <AmountInput value={form.agreedPrice} onChange={(v) => setForm((p) => ({ ...p, agreedPrice: v }))} className={inputClass} placeholder="e.g. 8,500,000" />
          {offer && <p className="mt-1 text-[10px] text-slate-400">Pre-filled from the accepted price — adjust if a final verbal agreement was reached.</p>}
        </div>
        <div>
          <AppSelect
            label="Payment Plan"
            value={form.paymentPlan}
            onChange={(v) => setForm((p) => ({ ...p, paymentPlan: v ?? "installment", expectedClosingDate: v === "cash" ? "" : p.expectedClosingDate }))}
            options={PAYMENT_PLAN_OPTIONS}
            size="sm"
          />
        </div>
        <div>
          <label className={labelClass}>{T.saleDeal} Date</label>
          <input type="date" value={form.dealDate} onChange={(e) => setForm((p) => ({ ...p, dealDate: e.target.value }))} className={inputClass} />
        </div>
        {form.paymentPlan !== "cash" && (
          <div>
            <label className={labelClass}>Expected Closing Date</label>
            <input type="date" value={form.expectedClosingDate} onChange={(e) => setForm((p) => ({ ...p, expectedClosingDate: e.target.value }))} className={inputClass} />
          </div>
        )}
        {!editingId && form.paymentPlan !== "cash" && (
          <div className="md:col-span-3 border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Payment Schedule</div>
            <div className="grid items-end gap-3 sm:grid-cols-5">
              <div>
                <label className={labelClass}>Deposit</label>
                <div className="flex gap-1">
                  <input type="number" min="0" value={form.depositValue} onChange={(e) => updateScheduleInput({ depositValue: e.target.value })} className={inputClass} placeholder={form.depositMode === "percent" ? "e.g. 25" : "e.g. 2,000,000"} />
                  <div className="flex shrink-0 border border-slate-200 bg-white">
                    {DEPOSIT_MODE_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => updateScheduleInput({ depositMode: o.value })}
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
                <input type="number" min="0" value={form.installmentCount} onChange={(e) => updateScheduleInput({ installmentCount: e.target.value })} className={inputClass} placeholder="e.g. 12" />
              </div>
              <div>
                <AppSelect label="Frequency" value={form.frequency} onChange={(v) => updateScheduleInput({ frequency: v ?? "monthly" })} options={FREQUENCY_OPTIONS} size="sm" />
              </div>
              <div>
                <label className={labelClass}>First Installment Due</label>
                <input type="date" value={form.firstInstallmentDate} onChange={(e) => updateScheduleInput({ firstInstallmentDate: e.target.value })} className={inputClass} />
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    const rows = generateScheduleRows({
                      agreedPrice: form.agreedPrice, dealDate: form.dealDate, depositMode: form.depositMode,
                      depositValue: form.depositValue, installmentCount: form.installmentCount,
                      frequency: form.frequency, firstInstallmentDate: form.firstInstallmentDate,
                    });
                    if (!rows.length) { toast.warn("Enter agreed price, # of installments and the first due date first"); return; }
                    setForm((p) => ({ ...p, scheduleRows: rows, expectedClosingDate: rows[rows.length - 1].dueDate }));
                  }}
                  className="h-7 w-full border border-[#B7C9C0] bg-[#F1F6F3] text-xs font-bold text-[#0B3B2E] hover:bg-[#B7C9C0]/40"
                >
                  Generate
                </button>
              </div>
            </div>
            {form.scheduleRows.length > 0 && (
              <div className="mt-2.5">
                <ScheduleRowsEditor
                  items={form.scheduleRows}
                  setItems={(updater) => setForm((p) => ({ ...p, scheduleRows: typeof updater === "function" ? updater(p.scheduleRows) : updater }))}
                  agreedPrice={Number(form.agreedPrice) || 0}
                />
              </div>
            )}
          </div>
        )}
        <div className="md:col-span-3">
          <label className={labelClass}>Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={textareaClass} />
        </div>
      </div>
    </Modal>
  );
}
