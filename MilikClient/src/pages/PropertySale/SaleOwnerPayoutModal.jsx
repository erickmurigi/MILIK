import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPlus } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import CurrencyInput from "../../components/common/CurrencyInput";
import Modal from "../../components/common/Modal";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";

const todayIso = () => new Date().toISOString().slice(0, 10);

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";

const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

const Section = ({ title, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white ${className}`}>
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">{title}</h3>
    </div>
    <div className="p-2.5">{children}</div>
  </div>
);

const SOURCE_OPTS = [
  { value: "company_cashbook", label: "Company Cashbook" },
  { value: "advocate_trust", label: "Advocate Trust (per deal)" },
];

// Shared by SaleOwnerPayouts.jsx (blank, owner picked in the form) and SaleOwnerStatementsApproved.jsx
// (opened from a specific approved statement's "Pay Owner" action, owner + the statement's balance
// pre-filled as a real editable value — one click pays it in full, or edit the amount down to pay
// partially; the backend already accepts anything up to the owner's outstanding balance).
const RecordOwnerPayoutModal = ({ ownerOptions, initialOwnerId = "", initialAmount = "", onClose, onSaved }) => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const T = useTerms("saleOwner");
  const [form, setForm] = useState({
    owner: initialOwnerId, source: "company_cashbook", amount: initialAmount ? String(initialAmount) : "",
    date: todayIso(), cashbook: "", advocate: "", cgtAmount: "", cgtReference: "", reference: "", notes: "",
  });
  // Trust is drawn per-deal, possibly across several of the owner's deals in one combined payout —
  // {[dealId]: "amount string"}, built into the API's allocations[] shape at submit time.
  const [dealAllocations, setDealAllocations] = useState({});
  const [saving, setSaving] = useState(false);

  // Only this owner's deals, each with its own currently-available trust balance for the acting
  // advocate — replaces an earlier "pick from every deal in the business" dropdown that wasn't even
  // scoped to the chosen owner, let alone to what trust is actually left to draw from.
  const { data: trustSummary, isFetching: loadingTrust } = useQuery({
    queryKey: ["sale-advocate-owner-trust-summary", biz, form.owner],
    queryFn: () => saleApi.getAdvocateOwnerTrustSummary(form.owner),
    enabled: !!biz && !!form.owner && form.source === "advocate_trust",
    staleTime: 10_000,
  });
  const trustDeals = trustSummary?.data ?? [];
  const allocatedTotal = useMemo(
    () => trustDeals.reduce((s, d) => s + (Number(dealAllocations[d.dealId]) || 0), 0),
    [trustDeals, dealAllocations]
  );

  const { data: cashbookAccounts } = useQuery({
    queryKey: ["sale-cashbook-accounts", biz],
    queryFn: () => saleApi.listCashbookAccounts({ business: biz }),
    enabled: !!biz && form.source === "company_cashbook",
    staleTime: 60_000,
  });
  const cashbookOptions = useMemo(() => (cashbookAccounts ?? []).map((a) => ({ value: a._id, label: a.name })), [cashbookAccounts]);

  const { data: advocatesData } = useQuery({
    queryKey: ["sale-advocates-ref-payout", biz],
    queryFn: () => saleApi.listAdvocates({ business: biz, status: "active", limit: 500 }),
    enabled: !!biz && form.source === "advocate_trust",
    staleTime: 60_000,
  });
  const advocateOptions = useMemo(() => (advocatesData?.data ?? []).map((a) => ({ value: a._id, label: a.firm ? `${a.fullName} (${a.firm})` : a.fullName })), [advocatesData]);

  const handleSubmit = async () => {
    if (!form.owner) return toast.warning(`Choose a ${T.saleOwner.toLowerCase()} first`);
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.warning("Enter an amount greater than 0");
    const cgtAmount = form.cgtAmount ? Number(form.cgtAmount) : 0;

    let allocations;
    if (form.source === "advocate_trust") {
      allocations = trustDeals
        .map((d) => ({ deal: d.dealId, amount: Number(dealAllocations[d.dealId]) || 0 }))
        .filter((a) => a.amount > 0);
      if (!allocations.length) return toast.warning("Allocate this payout to at least one deal's trust balance");
      const totalAllocated = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
      const totalClaim = Math.round((amount + cgtAmount) * 100) / 100;
      if (Math.abs(totalAllocated - totalClaim) > 0.01) {
        return toast.warning(`Allocated KES ${totalAllocated.toLocaleString()} across deals but the payout is for KES ${totalClaim.toLocaleString()} — they must match exactly`);
      }
    }
    if (!form.reference.trim()) return toast.warning("Enter a reference number");
    setSaving(true);
    try {
      await saleApi.createOwnerPayout({
        owner: form.owner,
        amount,
        date: form.date,
        source: form.source,
        cashbook: form.source === "company_cashbook" ? (form.cashbook || undefined) : undefined,
        allocations: form.source === "advocate_trust" ? allocations : undefined,
        advocate: form.source === "advocate_trust" ? (form.advocate || undefined) : undefined,
        cgtAmount,
        cgtReference: form.cgtReference || "",
        reference: form.reference,
        notes: form.notes,
      });
      toast.success("Payout recorded");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record Owner Payout"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-8 border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
            <FaPlus size={9} /> {saving ? "Saving…" : "Record Payout"}
          </button>
        </>
      }
    >
      <div className="space-y-2.5">
        <Section title="Payment Details">
          <div className="grid gap-2.5 md:grid-cols-3">
            <div>
              <label className={labelClass}>{T.saleOwner}<Required /></label>
              <AppSelect value={form.owner} onChange={(v) => { setForm((p) => ({ ...p, owner: v ?? "" })); setDealAllocations({}); }} options={ownerOptions} placeholder={`Choose ${T.saleOwner.toLowerCase()}…`} size="sm" searchable clearable />
            </div>
            <div>
              <label className={labelClass}>Source</label>
              <AppSelect value={form.source} onChange={(v) => { setForm((p) => ({ ...p, source: v || "company_cashbook", cashbook: "", advocate: "" })); setDealAllocations({}); }} options={SOURCE_OPTS} size="sm" />
            </div>
            <div>
              <label className={labelClass}>Amount<Required /></label>
              <CurrencyInput value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className={inputClass} />
            </div>

            {form.source === "company_cashbook" ? (
              <div>
                <label className={labelClass}>Cashbook</label>
                <AppSelect value={form.cashbook} onChange={(v) => setForm((p) => ({ ...p, cashbook: v ?? "" }))} options={cashbookOptions} placeholder="Cashbook…" size="sm" clearable />
              </div>
            ) : (
              <div>
                <label className={labelClass}>Advocate (optional)</label>
                <AppSelect value={form.advocate} onChange={(v) => setForm((p) => ({ ...p, advocate: v ?? "" }))} options={advocateOptions} placeholder="Advocate…" size="sm" searchable clearable />
              </div>
            )}

            <div>
              <label className={labelClass}>Reference<Required /></label>
              <input value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Notes</label>
              <input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={inputClass} />
            </div>
          </div>
        </Section>

        {form.source === "advocate_trust" && form.owner && (
          <Section title="Draw From Deal(s)">
            {loadingTrust ? (
              <p className="text-xs text-slate-400">Loading available trust…</p>
            ) : !trustDeals.length ? (
              <p className="text-xs text-slate-400">No trust held for this {T.saleOwner.toLowerCase()} right now.</p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-500">
                  Split this payout across however many of the {T.saleOwner.toLowerCase()}'s deals it came from — e.g. several plots closed around the same time, handed over in one payment.
                </p>
                {trustDeals.map((d) => (
                  <div key={d.dealId} className="flex items-center gap-2">
                    <div className="flex-1 truncate text-xs font-semibold text-slate-700">{d.listingLabel}</div>
                    <div className="w-28 shrink-0 text-right text-[11px] text-slate-400">avail. {Number(d.available).toLocaleString()}</div>
                    <CurrencyInput
                      prefix={null}
                      value={dealAllocations[d.dealId] || ""}
                      onChange={(e) => setDealAllocations((p) => ({ ...p, [d.dealId]: e.target.value }))}
                      inputClassName={`${inputClass} w-28 shrink-0`}
                      placeholder="0"
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 text-[11px] font-bold">
                  <span className="text-slate-500">Allocated</span>
                  <span className={allocatedTotal === (Number(form.amount) || 0) + (Number(form.cgtAmount) || 0) ? "text-emerald-700" : "text-amber-600"}>
                    {allocatedTotal.toLocaleString()} / {((Number(form.amount) || 0) + (Number(form.cgtAmount) || 0)).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </Section>
        )}

        <Section title="Withholding Tax (Optional)">
          <div className="grid gap-2.5 md:grid-cols-2">
            <div>
              <label className={labelClass}>CGT Withheld</label>
              <CurrencyInput value={form.cgtAmount} onChange={(e) => setForm((p) => ({ ...p, cgtAmount: e.target.value }))} inputClassName={inputClass.replace("px-2.5", "pl-10 pr-2.5")} />
            </div>
            <div>
              <label className={labelClass}>CGT Reference</label>
              <input value={form.cgtReference} onChange={(e) => setForm((p) => ({ ...p, cgtReference: e.target.value }))} className={inputClass} />
            </div>
          </div>
        </Section>
      </div>
    </Modal>
  );
};

export default RecordOwnerPayoutModal;
