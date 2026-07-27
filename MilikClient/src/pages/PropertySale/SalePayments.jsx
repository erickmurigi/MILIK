import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBan, FaEdit, FaPlus, FaPrint, FaRedoAlt, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";

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

const PAYMENT_TYPES   = ["deposit", "installment", "final_payment", "other"];
const PAYMENT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const PAGE_SIZE       = 50;

const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const EMPTY_FORM = {
  deal: "", amount: "", paymentType: "installment",
  paymentMethod: "bank_transfer", cashbook: "",
  reference: "", paymentDate: todayISO(), notes: "",
};

const Modal = ({ title, subtitle, headerCls = "bg-[#0B3B2E]", children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-xl sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
      <div className={`flex-shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 ${headerCls} px-4 py-3 text-white rounded-t-2xl sm:rounded-none`}>
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-white/70">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const SalePayments = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [showCreate,   setShowCreate]   = useState(false);
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [selectedDeal, setSelectedDeal] = useTabState("/sale/payments:selectedDeal", null);
  const [saving,       setSaving]       = useState(false);
  const [voiding,      setVoiding]      = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [editForm,     setEditForm]     = useState({});
  const [editSaving,   setEditSaving]   = useState(false);

  const [dealFilter,   setDealFilter]   = useTabState("/sale/payments:dealFilter", "");
  const [typeFilter,   setTypeFilter]   = useTabState("/sale/payments:typeFilter", "");
  const [methodFilter, setMethodFilter] = useTabState("/sale/payments:methodFilter", "");
  const [statusFilter, setStatusFilter] = useTabState("/sale/payments:statusFilter", "");
  const [search,       setSearch]       = useTabState("/sale/payments:search", "");
  const [page,         setPage]         = useTabState("/sale/payments:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/payments:pageSize", PAGE_SIZE);

  const { data: paymentsData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-payments", biz, dealFilter, typeFilter, methodFilter, statusFilter, search, page, pageSize],
    queryFn:  () => saleApi.listPayments({
      business: biz, limit: pageSize, page,
      ...(dealFilter   && { deal: dealFilter }),
      ...(typeFilter   && { paymentType: typeFilter }),
      ...(methodFilter && { paymentMethod: methodFilter }),
      ...(statusFilter && { status: statusFilter }),
      ...(search       && { search }),
    }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const { data: dealsRef } = useQuery({
    queryKey: ["sale-deals-ref", biz],
    queryFn:  () => saleApi.listDeals({ business: biz, limit: 500 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });

  const { data: cashbookAccounts = [] } = useQuery({
    queryKey: ["sale-cashbook-accounts", biz],
    queryFn:  () => saleApi.listCashbookAccounts({ business: biz }),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });

  const payments      = paymentsData?.data ?? [];
  const total         = paymentsData?.total ?? 0;
  const totalPages    = Math.max(1, Math.ceil(total / pageSize));
  const totalCollected = paymentsData?.totalCollected ?? 0;
  const deals         = dealsRef?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sale-payments", biz] });

  const handleDealSelect = (dealId) => {
    setForm((f) => ({ ...f, deal: dealId }));
    setSelectedDeal(deals.find((x) => x._id === dealId) || null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.deal || !form.amount || !form.paymentDate) {
      toast.warn("Deal, amount and date are required");
      return;
    }
    if (!form.cashbook && cashbookAccounts.length > 0) {
      toast.warn("Please select a receiving cashbook");
      return;
    }
    setSaving(true);
    try {
      await saleApi.createPayment({ ...form, business: biz });
      toast.success("Payment recorded");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setSelectedDeal(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-deals", biz] });
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (payment) => {
    setEditTarget(payment);
    setEditForm({
      paymentType:   payment.paymentType   || "installment",
      paymentMethod: payment.paymentMethod || "bank_transfer",
      cashbook:      payment.cashbook?._id || payment.cashbook || "",
      amount:        payment.amount        || "",
      paymentDate:   payment.paymentDate ? new Date(payment.paymentDate).toISOString().slice(0, 10) : "",
      reference:     payment.reference     || "",
      notes:         payment.notes         || "",
    });
  };

  const handleEditSave = async () => {
    if (!editForm.amount || !editForm.paymentDate) {
      toast.warn("Amount and date are required");
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

  const handleVoid = async (payment) => {
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
  };

  const handleDelete = async (payment) => {
    if (!await confirm({ title: "Delete Payment", message: `Permanently delete ${payment.paymentNumber}?`, confirmText: "Delete", isDangerous: true })) return;
    try {
      await saleApi.deletePayment(payment._id);
      toast.success("Payment deleted");
      invalidate();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete payment");
    }
  };

  const hasFilters     = dealFilter || typeFilter || methodFilter || statusFilter || search;
  const resetFilters   = () => { setDealFilter(""); setTypeFilter(""); setMethodFilter(""); setStatusFilter(""); setSearch(""); setPage(1); };
  return (
    <PropertySaleShell
      title="Payments"
      subtitle={`${total} payment(s)`}
      action={
        <>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-payments", biz] })}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => { setForm(EMPTY_FORM); setSelectedDeal(null); setShowCreate(true); }}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaPlus size={9} /> Record Payment
          </button>
        </>
      }
    >
      {/* Filter bar */}
      <div className="mb-1 flex flex-wrap items-center gap-1 border border-slate-200 bg-white px-2 py-1 shadow-sm">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Receipt no."
          className="h-7 w-28 border border-slate-300 px-2 text-xs placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
        />
        <select
          value={dealFilter}
          onChange={(e) => { setDealFilter(e.target.value); setPage(1); }}
          className="h-7 max-w-[180px] border border-[#B7C9C0] bg-[#F1F6F3] px-1.5 text-xs font-semibold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All Deals</option>
          {deals.map((d) => (
            <option key={d._id} value={d._id}>{d.dealNumber} — {d.listing?.title || d.listing?.listingNumber || ""}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="h-7 border border-slate-200 bg-slate-50 px-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All Types</option>
          {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
        </select>
        <select
          value={methodFilter}
          onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }}
          className="h-7 border border-slate-200 bg-slate-50 px-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All Methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="h-7 border border-slate-200 bg-slate-50 px-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All Statuses</option>
          {["paid", "pending", "cancelled"].map((s) => <option key={s} value={s}>{fmtLabel(s)}</option>)}
        </select>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="h-7 border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-100">
            Clear
          </button>
        )}
      </div>

      {/* Total collected stat */}
      <div className="mb-1 flex items-center gap-3 border border-emerald-200 bg-emerald-50 px-3 py-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Total Collected (active filters)</span>
        <span className="text-sm font-black text-emerald-800">{fmtKES(totalCollected)}</span>
        <span className="ml-auto text-[10px] text-emerald-600">{total} payment(s)</span>
      </div>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[860px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#0B3B2E]">
                {["Receipt No.", "Deal", "Property / Buyer", "Type", "Method", "Reference", "Amount", "Date", "Status", "Actions"].map((h) => (
                  <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${h === "Amount" || h === "Actions" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-xs text-slate-400">Loading payments…</td></tr>
              ) : payments.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-xs text-slate-400">No payments found.{hasFilters ? " Try clearing filters." : ""}</td></tr>
              ) : payments.map((p) => (
                <tr key={p._id} className={`border-b border-slate-100 ${p.status === "cancelled" ? "bg-rose-50/40 opacity-60" : "hover:bg-slate-50"}`}>
                  <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">
                    {p.paymentNumber}
                    {p.status === "cancelled" && <div className="text-[9px] font-black uppercase text-rose-500">voided</div>}
                  </td>
                  <td className="px-3 py-2 font-bold text-slate-700">{p.deal?.dealNumber || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-700">{p.deal?.listing?.title || p.deal?.listing?.listingNumber || "—"}</div>
                    <div className="text-[10px] text-slate-400">{p.deal?.buyer?.fullName || "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${TYPE_BADGE[p.paymentType] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {fmtLabel(p.paymentType)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${METHOD_BADGE[p.paymentMethod] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {fmtLabel(p.paymentMethod)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{p.reference || "—"}</td>
                  <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(p.amount)}</td>
                  <td className="px-3 py-2 text-slate-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE") : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[p.status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => window.open(`/sale/payments/${p._id}/receipt`, "_blank")} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]" title="Print Receipt">
                        <FaPrint className="text-[9px]" />
                      </button>
                      {p.status !== "cancelled" && (
                        <button type="button" onClick={() => openEdit(p)} className="border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100">
                          <FaEdit className="text-[9px]" />
                        </button>
                      )}
                      {p.status === "paid" && (
                        <button
                          type="button"
                          onClick={() => handleVoid(p)}
                          disabled={voiding === p._id}
                          className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-40"
                        >
                          <FaBan className="text-[9px]" />
                        </button>
                      )}
                      {p.status === "cancelled" && (
                        <button type="button" onClick={() => handleDelete(p)} className="border border-red-200 bg-white px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-50">
                          <FaTimes className="text-[9px]" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* Edit Payment Modal */}
      {editTarget && (
        <Modal
          title="Edit Payment"
          subtitle={`Editing ${editTarget.paymentNumber}`}
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditTarget(null)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleEditSave} disabled={editSaving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Type</label>
                <select value={editForm.paymentType} onChange={(e) => setEditForm((f) => ({ ...f, paymentType: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none">
                  {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Method</label>
                <select value={editForm.paymentMethod} onChange={(e) => setEditForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none">
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
                </select>
              </div>
            </div>
            {/* Cashbook — determines which bank/cash GL account is debited */}
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Receiving Cashbook *</label>
              <select
                value={editForm.cashbook}
                onChange={(e) => setEditForm((f) => ({ ...f, cashbook: e.target.value }))}
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none"
              >
                <option value="">— Select cashbook —</option>
                {cashbookAccounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
              {cashbookAccounts.length === 0 && (
                <p className="mt-1 text-[10px] text-amber-600">No cashbook accounts found — set up bank/cash accounts in Chart of Accounts first.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Amount (KES) *</label>
                <AmountInput value={editForm.amount} onChange={(v) => setEditForm((f) => ({ ...f, amount: v }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Date *</label>
                <input type="date" value={editForm.paymentDate} onChange={(e) => setEditForm((f) => ({ ...f, paymentDate: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Reference</label>
              <input type="text" value={editForm.reference} onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs font-mono focus:border-[#0B3B2E] focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Notes</label>
              <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}

      {/* Record Payment Modal */}
      {showCreate && (
        <Modal
          title="Record Payment"
          subtitle="Post a payment against a deal"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowCreate(false)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleCreate} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : "Record Payment"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {/* Deal selector */}
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Deal *</label>
              <select
                value={form.deal}
                onChange={(e) => handleDealSelect(e.target.value)}
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none"
                required
              >
                <option value="">Select active deal…</option>
                {deals.filter((d) => d.status === "active").map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.dealNumber} — {d.listing?.title || d.listing?.listingNumber || ""} ({d.buyer?.fullName || ""})
                  </option>
                ))}
              </select>
            </div>

            {/* Deal balance summary */}
            {selectedDeal && (
              <div className="grid grid-cols-3 gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
                <div>
                  <div className="font-black uppercase tracking-wider text-slate-400">Deal Value</div>
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
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Type *</label>
                <select value={form.paymentType} onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none">
                  {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Method *</label>
                <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none">
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
                </select>
              </div>
            </div>

            {/* Cashbook — determines which bank/cash GL account is debited */}
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Receiving Cashbook *</label>
              <select
                value={form.cashbook}
                onChange={(e) => setForm((f) => ({ ...f, cashbook: e.target.value }))}
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none"
                required
              >
                <option value="">— Select cashbook —</option>
                {cashbookAccounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
              {cashbookAccounts.length === 0 && (
                <p className="mt-1 text-[10px] text-amber-600">No cashbook accounts found — set up bank/cash accounts in Chart of Accounts first.</p>
              )}
            </div>

            {/* Amount + Date */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Amount (KES) *</label>
                <AmountInput value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" placeholder="e.g. 500,000" required />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Date *</label>
                <input type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none" required />
              </div>
            </div>

            {/* Reference */}
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                {form.paymentMethod === "mpesa" ? "M-Pesa Transaction Code" : form.paymentMethod === "cheque" ? "Cheque No." : form.paymentMethod === "bank_transfer" ? "EFT / Reference No." : "Reference"}
              </label>
              <input
                type="text"
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder={form.paymentMethod === "mpesa" ? "e.g. QJ1X23ABC4D" : form.paymentMethod === "bank_transfer" ? "e.g. RTGS/001/2026" : "Optional…"}
                className={`h-8 w-full border px-2 text-xs font-mono focus:outline-none ${["mpesa","cheque","bank_transfer"].includes(form.paymentMethod) ? "border-amber-300 bg-amber-50 focus:border-amber-500" : "border-slate-200 bg-white focus:border-[#0B3B2E]"}`}
              />
              {["mpesa","cheque","bank_transfer"].includes(form.paymentMethod) && (
                <div className="mt-1 text-[10px] font-semibold text-amber-600">Recommended for {fmtLabel(form.paymentMethod)} — used for reconciliation</div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-[#0B3B2E] focus:outline-none" />
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
};

export default SalePayments;
