import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPlus } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
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
    date: todayIso(), cashbook: "", deal: "", advocate: "", cgtAmount: "", cgtReference: "", reference: "", notes: "",
  });
  const [saving, setSaving] = useState(false);

  const { data: dealsData } = useQuery({
    queryKey: ["sale-deals-ref-payout", biz],
    queryFn: () => saleApi.listDeals({ business: biz, limit: 500 }),
    enabled: !!biz && form.source === "advocate_trust",
    staleTime: 60_000,
  });
  const dealOptions = useMemo(
    () => (dealsData?.data ?? []).map((d) => ({ value: d._id, label: `${d.dealNumber} — ${d.buyer?.fullName || "—"}${d.listing?.title || d.listing?.listingNumber ? ` (${d.listing.title || d.listing.listingNumber})` : ""}` })),
    [dealsData]
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
    if (form.source === "advocate_trust" && !form.deal) return toast.warning("Choose the deal this trust payout is drawn from");
    if (!form.reference.trim()) return toast.warning("Enter a reference number");
    setSaving(true);
    try {
      await saleApi.createOwnerPayout({
        owner: form.owner,
        amount,
        date: form.date,
        source: form.source,
        cashbook: form.source === "company_cashbook" ? (form.cashbook || undefined) : undefined,
        deal: form.source === "advocate_trust" ? form.deal : undefined,
        advocate: form.source === "advocate_trust" ? (form.advocate || undefined) : undefined,
        cgtAmount: form.cgtAmount ? Number(form.cgtAmount) : 0,
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
              <AppSelect value={form.owner} onChange={(v) => setForm((p) => ({ ...p, owner: v ?? "" }))} options={ownerOptions} placeholder={`Choose ${T.saleOwner.toLowerCase()}…`} size="sm" searchable clearable />
            </div>
            <div>
              <label className={labelClass}>Source</label>
              <AppSelect value={form.source} onChange={(v) => setForm((p) => ({ ...p, source: v || "company_cashbook", cashbook: "", deal: "", advocate: "" }))} options={SOURCE_OPTS} size="sm" />
            </div>
            <div>
              <label className={labelClass}>Amount<Required /></label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className={inputClass} />
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
              <>
                <div>
                  <label className={labelClass}>Deal (trust source)<Required /></label>
                  <AppSelect value={form.deal} onChange={(v) => setForm((p) => ({ ...p, deal: v ?? "" }))} options={dealOptions} placeholder="Choose deal…" size="sm" searchable clearable />
                </div>
                <div>
                  <label className={labelClass}>Advocate (optional)</label>
                  <AppSelect value={form.advocate} onChange={(v) => setForm((p) => ({ ...p, advocate: v ?? "" }))} options={advocateOptions} placeholder="Advocate…" size="sm" searchable clearable />
                </div>
              </>
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

        <Section title="Withholding Tax (Optional)">
          <div className="grid gap-2.5 md:grid-cols-2">
            <div>
              <label className={labelClass}>CGT Withheld</label>
              <input type="number" min="0" value={form.cgtAmount} onChange={(e) => setForm((p) => ({ ...p, cgtAmount: e.target.value }))} className={inputClass} />
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
