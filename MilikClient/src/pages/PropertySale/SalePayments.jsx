import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBan, FaPlus, FaPrint, FaRedoAlt, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";

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
  paymentMethod: "bank_transfer", reference: "",
  paymentDate: todayISO(), notes: "",
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
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [voiding,      setVoiding]      = useState(null);

  const [dealFilter,   setDealFilter]   = useState("");
  const [typeFilter,   setTypeFilter]   = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(1);
  const [pageSize,     setPageSize]     = useState(PAGE_SIZE);

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

  const payments      = paymentsData?.payments ?? paymentsData?.data ?? [];
  const total         = paymentsData?.total ?? 0;
  const totalPages    = Math.max(1, Math.ceil(total / pageSize));
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

  const printReceipt = (payment) => {
    const co      = currentCompany || {};
    const deal    = payment.deal    || {};
    const listing = deal.listing    || {};
    const buyer   = deal.buyer      || {};
    const html = `<!DOCTYPE html><html><head><title>Receipt — ${payment.paymentNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;background:#fff}
.page{max-width:148mm;margin:0 auto;padding:14mm 14mm 10mm}
.hdr{border-bottom:3px solid #0B3B2E;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start}
.brand{font-size:20px;font-weight:900;color:#0B3B2E;letter-spacing:2px}
.co-info{text-align:right;font-size:9px;color:#444;line-height:1.7}
.doc-title{text-align:center;margin:12px 0 14px}
.doc-title h1{font-size:20px;font-weight:900;letter-spacing:4px;color:#0B3B2E;text-transform:uppercase}
.doc-title p{font-size:9px;color:#555;margin-top:2px}
.receipt-no{background:#0B3B2E;color:#fff;padding:8px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
.receipt-no span{font-weight:900;font-size:14px;font-family:monospace}
.receipt-no small{font-size:9px;opacity:.8}
.amount-box{background:#0B3B2E;color:#fff;padding:14px 20px;margin:14px 0;text-align:center}
.amount-box .lbl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.7}
.amount-box .amt{font-size:28px;font-weight:900;font-family:monospace;margin-top:2px}
.voided-banner{background:#dc2626;color:#fff;padding:6px 14px;margin-bottom:12px;text-align:center;font-size:11px;font-weight:900;letter-spacing:3px}
.sec{font-size:9px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#0B3B2E;border-bottom:1.5px solid #0B3B2E;padding-bottom:4px;margin:12px 0 8px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
.f label{font-size:8.5px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}
.f span{font-size:11px;font-weight:600;color:#111;display:block;padding:4px 8px;border:1px solid #e5e7eb;background:#fafafa;min-height:24px}
.thanks{text-align:center;margin:16px 0 8px;font-size:13px;font-weight:900;letter-spacing:3px;color:#0B3B2E;text-transform:uppercase}
.sig-box{border-top:1.5px solid #333;padding-top:6px;margin-top:24px;max-width:200px}
.sig-box p{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#555;margin-top:2px}
.footer{margin-top:16px;padding-top:8px;border-top:1.5px solid #0B3B2E;font-size:8px;color:#777;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
<div class="hdr">
  <div class="brand">${co.logo ? `<img src="${co.logo}" alt="logo" style="height:48px;object-fit:contain"/>` : (co.companyName || "MILIK")}</div>
  <div class="co-info"><strong>${co.companyName || ""}</strong><br/>${co.physicalAddress || co.postalAddress || ""}<br/>${[co.telephone, co.email].filter(Boolean).join(" | ")}</div>
</div>
<div class="doc-title"><h1>Payment Receipt</h1><p>Official Receipt — Property Sale Transaction</p></div>
${payment.status === "cancelled" ? '<div class="voided-banner">&#9888; VOIDED / CANCELLED</div>' : ""}
<div class="receipt-no">
  <div><small>Receipt No.</small><br/><span>${payment.paymentNumber}</span></div>
  <div style="text-align:right"><small>Payment Date</small><br/><span>${payment.paymentDate ? new Date(payment.paymentDate).toLocaleDateString("en-KE") : ""}</span></div>
</div>
<div class="amount-box">
  <div class="lbl">Amount ${payment.status === "cancelled" ? "(VOIDED)" : "Received"}</div>
  <div class="amt">${fmtKES(payment.amount)}</div>
  <div style="font-size:10px;opacity:.75;margin-top:4px">${fmtLabel(payment.paymentType)} via ${fmtLabel(payment.paymentMethod)}</div>
</div>
<div class="sec">Deal Reference</div>
<div class="g2">
  <div class="f"><label>Deal No.</label><span>${deal.dealNumber || "—"}</span></div>
  <div class="f"><label>Property</label><span>${listing.title || listing.listingNumber || "—"}</span></div>
  <div class="f"><label>Buyer</label><span>${buyer.fullName || "—"}</span></div>
  <div class="f"><label>Agreed Price</label><span>${fmtKES(deal.agreedPrice)}</span></div>
</div>
<div class="sec">Payment Details</div>
<div class="g2">
  <div class="f"><label>Payment Type</label><span>${fmtLabel(payment.paymentType)}</span></div>
  <div class="f"><label>Method</label><span>${fmtLabel(payment.paymentMethod)}</span></div>
  ${payment.reference ? `<div class="f" style="grid-column:1/-1"><label>Reference / Transaction ID</label><span style="font-family:monospace;font-weight:900">${payment.reference}</span></div>` : ""}
  <div class="f"><label>Status</label><span style="text-transform:uppercase;color:${payment.status === "paid" ? "#0B3B2E" : "#dc2626"};font-weight:900">${payment.status}</span></div>
</div>
${payment.notes ? `<div class="sec">Notes</div><div style="border:1px solid #e5e7eb;padding:8px;background:#fafafa;font-size:10.5px">${payment.notes}</div>` : ""}
<div class="thanks">— Received With Thanks —</div>
<div class="sig-box"><br/><p>Authorized Signature</p><p style="color:#111">${co.companyName || ""}</p></div>
<div class="footer">Computer-generated receipt, valid without physical signature. Generated: ${new Date().toLocaleString("en-KE")} | MILIK Property Sales System</div>
</div></body></html>`;
    const w = window.open("", "_blank", "width=800,height=650");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
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
                      <button type="button" onClick={() => printReceipt(p)} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                        <FaPrint className="text-[9px]" />
                      </button>
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
