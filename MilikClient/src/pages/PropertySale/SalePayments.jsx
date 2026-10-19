import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBan, FaEdit, FaPlus, FaPrint, FaRedoAlt, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch, FilterDateRange } from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import MilikTable from "../../components/common/MilikTable";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch, printSaleDocument } from "./salePrint";
import { printPaymentReceiptById } from "./SalePaymentReceipt";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { fmtDate } from "../../utils/dates";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";

const STATUS_BADGE = {
  paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending:   "border-amber-200 bg-amber-50 text-amber-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-600",
};
const METHOD_BADGE = {
  cash:          "border-orange-200 bg-orange-50 text-orange-700",
  mpesa:         "border-emerald-200 bg-emerald-50 text-emerald-700",
  bank_transfer: "border-blue-200 bg-blue-50 text-blue-700",
  cheque:        "border-violet-200 bg-violet-50 text-violet-700",
  other:         "border-slate-200 bg-slate-50 text-slate-600",
};
const TYPE_BADGE = {
  deposit:       "border-amber-200 bg-amber-50 text-amber-700",
  installment:   "border-blue-200 bg-blue-50 text-blue-700",
  final_payment: "border-emerald-200 bg-emerald-50 text-emerald-700",
  other:         "border-slate-200 bg-slate-50 text-slate-600",
};

const paymentTableCols = (T) => [
  { label: "Receipt No.", width: "9%" },
  { label: T.saleDeal, width: "8%" },
  { label: "Property", width: "14%" },
  { label: T.saleBuyer, width: "13%" },
  { label: "Type", width: "9%" },
  { label: "Method", width: "10%" },
  { label: "Reference", width: "10%" },
  { label: "Amount", align: "right", width: "11%" },
  { label: "Date", width: "8%" },
  { label: "Status", width: "8%" },
];

const PAYMENT_TYPES   = ["deposit", "installment", "final_payment", "other"];
const PAYMENT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const PAGE_SIZE       = 50;
// Methods with a real external reference (M-Pesa code, cheque no., EFT ref) require it — needed both to
// trace/reconcile the transaction and because the system-wide duplicate-reference guard needs something
// to key on. Cash/other have no such external record, so stay optional.
const REFERENCE_REQUIRED_METHODS = ["mpesa", "bank_transfer", "cheque"];

const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const PAYMENT_TYPE_OPTIONS   = PAYMENT_TYPES.map((t) => ({ value: t, label: fmtLabel(t) }));
const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: fmtLabel(m) }));
const STATUS_OPTIONS         = ["paid", "pending", "cancelled"].map((s) => ({ value: s, label: fmtLabel(s) }));

const EMPTY_FORM = {
  deal: "", amount: "", paymentType: "installment",
  paymentMethod: "bank_transfer", cashbook: "",
  reference: "", paymentDate: todayISO(), notes: "",
  collectionMethod: "direct", advocate: "",
};


// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const paymentRowClassName = (p) => p.status === "cancelled" ? "opacity-60 !bg-rose-50/40" : "";

const renderPaymentRow = (p) => (
  <>
    <td className="px-3 py-1.5 font-mono font-black text-[#0B3B2E] border-r border-gray-100">{p.paymentNumber}</td>
    <td className="px-3 py-1.5 font-bold text-slate-700 border-r border-gray-100">{p.deal?.dealNumber || "—"}</td>
    <td className="px-3 py-1.5 font-semibold text-slate-700 border-r border-gray-100">{p.deal?.listing?.title || p.deal?.listing?.listingNumber || "—"}</td>
    <td className="px-3 py-1.5 text-slate-600 border-r border-gray-100">{p.deal?.buyer?.fullName || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${TYPE_BADGE[p.paymentType] || "border-slate-200 bg-slate-50 text-slate-600"}`}>{fmtLabel(p.paymentType)}</span>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${METHOD_BADGE[p.paymentMethod] || "border-slate-200 bg-slate-50 text-slate-600"}`}>{fmtLabel(p.paymentMethod)}</span>
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-[10px] text-slate-500">{p.reference || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(p.amount)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE") : "—"}</td>
    <td className="px-3 py-1.5">
      <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[p.status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>{p.status}</span>
    </td>
  </>
);

// Modals below own their form state so keystrokes never re-render the page or its table.
// Submit handlers stay in the page (they own the in-flight `saving` guards).

const labelClass    = "mb-1 block text-xs font-bold text-slate-900";
const inputClass     = "h-7 w-full border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const textareaClass = "w-full border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;

function EditPaymentModal({ target, cashbookOptions, hasCashbooks, saving, onClose, onSubmit }) {
  const [editForm, setEditForm] = useState(() => ({
    paymentType:   target.paymentType   || "installment",
    paymentMethod: target.paymentMethod || "bank_transfer",
    cashbook:      target.cashbook?._id || target.cashbook || "",
    amount:        target.amount        || "",
    paymentDate:   target.paymentDate ? new Date(target.paymentDate).toISOString().slice(0, 10) : "",
    reference:     target.reference     || "",
    notes:         target.notes         || "",
  }));
  return (
    <Modal
      title="Edit Payment"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(editForm)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <AppSelect label="Type" value={editForm.paymentType} onChange={(v) => setEditForm((f) => ({ ...f, paymentType: v ?? "" }))} options={PAYMENT_TYPE_OPTIONS} size="sm" />
          </div>
          <div>
            <AppSelect label="Method" value={editForm.paymentMethod} onChange={(v) => setEditForm((f) => ({ ...f, paymentMethod: v ?? "" }))} options={PAYMENT_METHOD_OPTIONS} size="sm" />
          </div>
        </div>
        {/* Cashbook — determines which bank/cash GL account is debited */}
        <div>
          <AppSelect label="Receiving Cashbook" required value={editForm.cashbook} onChange={(v) => setEditForm((f) => ({ ...f, cashbook: v ?? "" }))} options={cashbookOptions} placeholder="— Select cashbook —" size="sm" searchable />
          {!hasCashbooks && (
            <p className="mt-1 text-[10px] text-amber-600">No cashbook accounts found — set up bank/cash accounts in Chart of Accounts first.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Amount (KES)<Required /></label>
            <AmountInput value={editForm.amount} onChange={(v) => setEditForm((f) => ({ ...f, amount: v }))} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Date<Required /></label>
            <input type="date" value={editForm.paymentDate} onChange={(e) => setEditForm((f) => ({ ...f, paymentDate: e.target.value }))} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Reference{REFERENCE_REQUIRED_METHODS.includes(editForm.paymentMethod) && <Required />}</label>
          <input type="text" value={editForm.reference} onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))} className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className={textareaClass} />
        </div>
      </div>
    </Modal>
  );
}

function RecordPaymentModal({ deals, activeDealOptions, cashbookOptions, hasCashbooks, saving, onClose, onSubmit, useAdvocates, advocateFormOptions }) {
  const T = useTerms("saleDeal");
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedDeal, setSelectedDeal] = useState(null);

  const handleDealSelect = (dealId) => {
    setForm((f) => ({ ...f, deal: dealId }));
    setSelectedDeal(deals.find((x) => x._id === dealId) || null);
  };

  return (
    <Modal
      title="Record Payment"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : "Record Payment"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Deal selector */}
        <div>
          <AppSelect label={T.saleDeal} required value={form.deal} onChange={(v) => handleDealSelect(v ?? "")} options={activeDealOptions} placeholder={`Select active ${T.saleDeal.toLowerCase()}…`} size="sm" searchable />
        </div>

        {/* Deal balance summary */}
        {selectedDeal && (
          <div className="grid grid-cols-3 gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
            <div>
              <div className="font-black uppercase tracking-wider text-slate-400">{T.saleDeal} Value</div>
              <div className="mt-0.5 font-black text-slate-800">{fmtKES(selectedDeal.agreedPrice)}</div>
            </div>
            <div>
              <div className="font-black uppercase tracking-wider text-slate-400">Paid So Far</div>
              <div className="mt-0.5 font-black text-emerald-700">{fmtKES(selectedDeal.totalPaid || 0)}</div>
            </div>
            <div>
              <div className="font-black uppercase tracking-wider text-slate-400">Balance Due</div>
              <div className={`mt-0.5 font-black ${(selectedDeal.agreedPrice - (selectedDeal.totalPaid || 0)) > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {fmtKES(selectedDeal.balance ?? (selectedDeal.agreedPrice - (selectedDeal.totalPaid || 0)))}
              </div>
            </div>
            <div className="col-span-3">
              {(() => {
                const paid  = selectedDeal.totalPaid || 0;
                const price = selectedDeal.agreedPrice || 1;
                const pct   = Math.min(100, Math.round((paid / price) * 100));
                return (
                  <div>
                    <div className="mb-1 flex justify-between text-[9px] text-slate-400"><span>Payment Progress</span><span>{pct}% paid</span></div>
                    <div className="h-1.5 w-full overflow-hidden bg-slate-200">
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Type + Method */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <AppSelect label="Type" required value={form.paymentType} onChange={(v) => setForm((f) => ({ ...f, paymentType: v ?? "" }))} options={PAYMENT_TYPE_OPTIONS} size="sm" />
          </div>
          <div>
            <AppSelect label="Method" required value={form.paymentMethod} onChange={(v) => setForm((f) => ({ ...f, paymentMethod: v ?? "" }))} options={PAYMENT_METHOD_OPTIONS} size="sm" />
          </div>
        </div>

        {/* Collection method — was it received directly, or did a conveyancing advocate collect it
            into their own trust account first? Only shown once Advocates is switched on in Settings. */}
        {useAdvocates && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <AppSelect
                label="Collected"
                value={form.collectionMethod}
                onChange={(v) => setForm((f) => ({ ...f, collectionMethod: v ?? "direct", advocate: v === "advocate_trust" ? f.advocate : "", cashbook: v === "advocate_trust" ? "" : f.cashbook }))}
                options={[{ value: "direct", label: "Direct to company" }, { value: "advocate_trust", label: "Via advocate trust account" }]}
                size="sm"
              />
            </div>
            {form.collectionMethod === "advocate_trust" && (
              <div>
                <AppSelect
                  label="Advocate"
                  required
                  value={form.advocate}
                  onChange={(v) => setForm((f) => ({ ...f, advocate: v ?? "" }))}
                  options={advocateFormOptions}
                  placeholder="Select advocate…"
                  size="sm"
                  searchable
                />
              </div>
            )}
          </div>
        )}

        {/* Cashbook — determines which bank/cash GL account is debited. Hidden when the advocate's
            trust account receives the money directly — the GL debits the trust receivable instead. */}
        {form.collectionMethod !== "advocate_trust" && (
          <div>
            <AppSelect label="Receiving Cashbook" required value={form.cashbook} onChange={(v) => setForm((f) => ({ ...f, cashbook: v ?? "" }))} options={cashbookOptions} placeholder="— Select cashbook —" size="sm" searchable />
            {!hasCashbooks && (
              <p className="mt-1 text-[10px] text-amber-600">No cashbook accounts found — set up bank/cash accounts in Chart of Accounts first.</p>
            )}
          </div>
        )}
        {form.collectionMethod === "advocate_trust" && (
          <p className="-mt-1 text-[10px] text-slate-500">This money sits in the advocate's trust account until they remit it — record that remittance separately from Trust Remittances once it arrives.</p>
        )}

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Amount (KES)<Required /></label>
            <AmountInput value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} className={inputClass} placeholder="e.g. 500,000" required />
          </div>
          <div>
            <label className={labelClass}>Date<Required /></label>
            <input type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} className={inputClass} required />
          </div>
        </div>

        {/* Reference */}
        <div>
          <label className={labelClass}>
            {form.paymentMethod === "mpesa" ? "M-Pesa Transaction Code" : form.paymentMethod === "cheque" ? "Cheque No." : form.paymentMethod === "bank_transfer" ? "EFT / Reference No." : "Reference"}
            {REFERENCE_REQUIRED_METHODS.includes(form.paymentMethod) && <Required />}
          </label>
          <input
            type="text"
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            placeholder={form.paymentMethod === "mpesa" ? "e.g. QJ1X23ABC4D" : form.paymentMethod === "bank_transfer" ? "e.g. RTGS/001/2026" : "Optional…"}
            className={`${inputClass} font-mono ${REFERENCE_REQUIRED_METHODS.includes(form.paymentMethod) ? "border-amber-300 bg-amber-50 focus:border-amber-500" : ""}`}
          />
          {REFERENCE_REQUIRED_METHODS.includes(form.paymentMethod) && (
            <div className="mt-1 text-[10px] font-semibold text-amber-600">Required for {fmtLabel(form.paymentMethod)} — used for reconciliation and must be unique</div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className={labelClass}>Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={textareaClass} />
        </div>
      </div>
    </Modal>
  );
}

const SalePayments = () => {
  const T = useTerms("saleDeal", "saleDeals", "saleBuyer");
  const paymentCols = useMemo(() => paymentTableCols(T), [T]);
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;
  const { saleSettings, advocateFormOptions } = useSaleFormOptions(biz);

  const [showCreate,   setShowCreate]   = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [voiding,      setVoiding]      = useState(null);
  const [deletingId,   setDeletingId]   = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [editSaving,   setEditSaving]   = useState(false);

  const [dealFilter,   setDealFilter]   = useTabState("/sale/payments:dealFilter", "");
  const [typeFilter,   setTypeFilter]   = useTabState("/sale/payments:typeFilter", "");
  const [methodFilter, setMethodFilter] = useTabState("/sale/payments:methodFilter", "");
  const [statusFilter, setStatusFilter] = useTabState("/sale/payments:statusFilter", "");
  const [search,       setSearch]       = useTabState("/sale/payments:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [dateFrom,     setDateFrom]     = useTabState("/sale/payments:dateFrom", "");
  const [dateTo,       setDateTo]       = useTabState("/sale/payments:dateTo", "");
  const [page,         setPage]         = useTabState("/sale/payments:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/payments:pageSize", PAGE_SIZE);

  const { data: paymentsData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-payments", biz, dealFilter, typeFilter, methodFilter, statusFilter, debouncedSearch, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listPayments({
      business: biz, limit: pageSize, page,
      ...(dealFilter   && { deal: dealFilter }),
      ...(typeFilter   && { paymentType: typeFilter }),
      ...(methodFilter && { paymentMethod: methodFilter }),
      ...(statusFilter && { status: statusFilter }),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
    }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const { data: dealsRef } = useQuery({
    queryKey: ["sale-deals-ref", biz],
    queryFn:  () => saleApi.listDeals({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });

  const { data: cashbookAccounts = [] } = useQuery({
    queryKey: ["sale-cashbook-accounts", biz],
    queryFn:  () => saleApi.listCashbookAccounts({ business: biz }),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });

  const payments      = useMemo(() => paymentsData?.data ?? [], [paymentsData]);
  const total         = paymentsData?.total ?? 0;
  const totalPages    = Math.max(1, Math.ceil(total / pageSize));
  const totalCollected = paymentsData?.totalCollected ?? 0;
  const deals         = useMemo(() => dealsRef?.data ?? [], [dealsRef]);

  const dealFilterOptions = useMemo(() => deals.map((d) => ({ value: d._id, label: `${d.dealNumber} — ${d.listing?.title || d.listing?.listingNumber || ""}` })), [deals]);
  const activeDealOptions = useMemo(() => deals.filter((d) => d.status === "active").map((d) => ({ value: d._id, label: `${d.dealNumber} — ${d.listing?.title || d.listing?.listingNumber || ""} (${d.buyer?.fullName || ""})` })), [deals]);
  const cashbookOptions   = useMemo(() => cashbookAccounts.map((a) => ({ value: a._id, label: a.name })), [cashbookAccounts]);

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ["sale-payments", biz] }), [queryClient, biz]);

  const handleCreate = async (form) => {
    if (!form.deal || !form.amount || !form.paymentDate) {
      toast.warn(`${T.saleDeal}, amount and date are required`);
      return;
    }
    if (REFERENCE_REQUIRED_METHODS.includes(form.paymentMethod) && !form.reference.trim()) {
      toast.warn(`A reference number is required for ${fmtLabel(form.paymentMethod)} payments`);
      return;
    }
    if (form.collectionMethod !== "advocate_trust" && !form.cashbook && cashbookAccounts.length > 0) {
      toast.warn("Please select a receiving cashbook");
      return;
    }
    if (form.collectionMethod === "advocate_trust" && !form.advocate) {
      toast.warn("Select which advocate collected this payment");
      return;
    }
    setSaving(true);
    try {
      await saleApi.createPayment({ ...form, business: biz });
      toast.success("Payment recorded");
      setShowCreate(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (editForm) => {
    if (!editForm.amount || !editForm.paymentDate) {
      toast.warn("Amount and date are required");
      return;
    }
    if (REFERENCE_REQUIRED_METHODS.includes(editForm.paymentMethod) && !editForm.reference.trim()) {
      toast.warn(`A reference number is required for ${fmtLabel(editForm.paymentMethod)} payments`);
      return;
    }
    setEditSaving(true);
    try {
      await saleApi.updatePayment(editTarget._id, { ...editForm, business: biz });
      toast.success("Payment updated");
      setEditTarget(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update payment");
    } finally {
      setEditSaving(false);
    }
  };

  const handleVoid = useCallback(async (payment) => {
    if (!await confirm({ title: "Void Payment", message: `Void ${payment.paymentNumber} of ${fmtKES(payment.amount)}?`, confirmText: "Void", isDangerous: true })) return;
    setVoiding(payment._id);
    try {
      await saleApi.voidPayment(payment._id, { business: biz });
      toast.success(`${payment.paymentNumber} voided`);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to void payment");
    } finally {
      setVoiding(null);
    }
  }, [confirm, biz, invalidate, queryClient]);

  const handleDelete = useCallback(async (payment) => {
    if (!await confirm({ title: "Delete Payment", message: `Permanently delete ${payment.paymentNumber}?`, confirmText: "Delete", isDangerous: true })) return;
    setDeletingId(payment._id);
    try {
      await saleApi.deletePayment(payment._id);
      toast.success("Payment deleted");
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete payment");
    } finally {
      setDeletingId(null);
    }
  }, [confirm, invalidate]);

  const renderPaymentActions = useCallback((p) => (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => printSaleDocument((win) => printPaymentReceiptById(p._id, { company: currentCompany, T, win }))} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]" title="Print Receipt">
        <FaPrint className="text-[9px]" />
      </button>
      {p.status !== "cancelled" && (
        <button type="button" onClick={() => setEditTarget(p)} className="border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
          <FaEdit className="text-[9px]" />
        </button>
      )}
      {p.status === "paid" && (
        <button type="button" onClick={() => handleVoid(p)} disabled={voiding === p._id} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-40">
          <FaBan className="text-[9px]" />
        </button>
      )}
      {p.status === "cancelled" && (
        <button type="button" onClick={() => handleDelete(p)} disabled={deletingId === p._id} className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40">
          <FaTimes className="text-[9px]" />
        </button>
      )}
    </div>
  ), [handleVoid, handleDelete, voiding, deletingId, currentCompany, T]);

  const buildReportFilters = () => ({
    business: biz,
    ...(dealFilter   && { deal: dealFilter }),
    ...(typeFilter   && { paymentType: typeFilter }),
    ...(methodFilter && { paymentMethod: methodFilter }),
    ...(statusFilter && { status: statusFilter }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(dateFrom     && { dateFrom }),
    ...(dateTo       && { dateTo }),
  });
  const reportColumns = [
    { label: "Receipt No.", value: (p) => p.paymentNumber },
    { label: T.saleDeal, value: (p) => p.deal?.dealNumber || "—" },
    { label: "Property", value: (p) => p.deal?.listing?.title || p.deal?.listing?.listingNumber || "—" },
    { label: T.saleBuyer, value: (p) => p.deal?.buyer?.fullName || "—" },
    { label: "Type", value: (p) => fmtLabel(p.paymentType) },
    { label: "Method", value: (p) => fmtLabel(p.paymentMethod) },
    { label: "Reference", value: (p) => p.reference || "—" },
    { label: "Amount (KES)", align: "right", value: (p) => money(p.amount) },
    { label: "Date", value: (p) => (p.paymentDate ? fmtDate(p.paymentDate) : "—") },
    { label: "Status", value: (p) => p.status },
  ];

  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const described = [
      dealFilter && dealFilterOptions.find((o) => o.value === dealFilter)?.label,
      typeFilter && fmtLabel(typeFilter),
      methodFilter && fmtLabel(methodFilter),
      statusFilter && `Status: ${fmtLabel(statusFilter)}`,
      (dateFrom || dateTo) && `${dateFrom ? fmtDate(dateFrom) : "…"} – ${dateTo ? fmtDate(dateTo) : "…"}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listPayments, buildReportFilters()), ({ rows }) => ({
      title: "Payments",
      subtitle: described.join(" · ") || "All payments",
      company: currentCompany,
      summaryItems: [["Collected", money(totalCollected)], ["Showing", `${rows.length} payments`]],
      columns: reportColumns,
      rows,
      totalsRow: ["TOTAL", "", "", "", "", "", "", money(rows.reduce((s, p) => s + Number(p.amount || 0), 0)), "", ""],
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportAfterFetch(() => fetchAllPages(saleApi.listPayments, buildReportFilters()), ({ rows }) => ({
      filename: "payments",
      columns: reportColumns,
      rows,
    }));
    setExporting(false);
  };

  const hasFilters     = dealFilter || typeFilter || methodFilter || statusFilter || search;
  const resetFilters   = () => { setDealFilter(""); setTypeFilter(""); setMethodFilter(""); setStatusFilter(""); setSearch(""); setDateFrom(""); setDateTo(""); setPage(1); };
  return (
    <PropertySaleShell>
      {/* Filter bar */}
      <SaleFilterBar
        leading={
          <span className="shrink-0 font-mono text-[9px] font-black text-emerald-700">{fmtKES(totalCollected)} collected</span>
        }
        onReset={resetFilters}
        activeCount={[search, dealFilter, typeFilter, methodFilter, statusFilter, dateFrom, dateTo].filter(Boolean).length}
        trailing={
          <>
            <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
            <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
            <ListToolbar.Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-payments", biz] })}
            >
              <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
            </ListToolbar.Button>
            <ListToolbar.Button icon={FaPlus} onClick={() => setShowCreate(true)}>
              Record Payment
            </ListToolbar.Button>
          </>
        }
      >
        <FilterSearch
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Receipt no. / buyer…"
          minWidth="130px"
        />
        <AppSelect value={dealFilter} onChange={(v) => { setDealFilter(v ?? ""); setPage(1); }} options={dealFilterOptions} placeholder={`All ${T.saleDeals}`} clearable compact searchable />
        <AppSelect value={typeFilter} onChange={(v) => { setTypeFilter(v ?? ""); setPage(1); }} options={PAYMENT_TYPE_OPTIONS} placeholder="All Types" clearable compact />
        <AppSelect value={methodFilter} onChange={(v) => { setMethodFilter(v ?? ""); setPage(1); }} options={PAYMENT_METHOD_OPTIONS} placeholder="All Methods" clearable compact />
        <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={STATUS_OPTIONS} placeholder="All Statuses" clearable compact />
        <FilterDateRange
          from={dateFrom} to={dateTo}
          onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
        />
      </SaleFilterBar>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <MilikTable
          columns={paymentCols}
          rows={payments}
          loading={loading}
          empty={`No payments found.${hasFilters ? " Try clearing filters." : ""}`}
          minWidth={860}
          rowClassName={paymentRowClassName}
          renderRow={renderPaymentRow}
          renderActions={renderPaymentActions}
        />

        <PaginationBar page={page} pages={totalPages} total={total} label="payments" pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* Edit Payment Modal */}
      {editTarget && (
        <EditPaymentModal target={editTarget} cashbookOptions={cashbookOptions} hasCashbooks={cashbookAccounts.length > 0} saving={editSaving} onClose={() => setEditTarget(null)} onSubmit={handleEditSave} />
      )}

      {/* Record Payment Modal */}
      {showCreate && (
        <RecordPaymentModal deals={deals} activeDealOptions={activeDealOptions} cashbookOptions={cashbookOptions} hasCashbooks={cashbookAccounts.length > 0} saving={saving} onClose={() => setShowCreate(false)} onSubmit={handleCreate} useAdvocates={Boolean(saleSettings?.useAdvocates)} advocateFormOptions={advocateFormOptions} />
      )}
    </PropertySaleShell>
  );
};

export default SalePayments;
