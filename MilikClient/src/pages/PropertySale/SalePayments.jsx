import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaBan, FaPlus, FaPrint, FaTimes } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import AmountInput from "./AmountInput";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";

const STATUS_BADGE = {
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  cancelled: "bg-rose-100 text-rose-700 border-rose-200",
};

const METHOD_BADGE = {
  cash: "bg-orange-100 text-orange-700 border-orange-200",
  mpesa: "bg-emerald-100 text-emerald-700 border-emerald-200",
  bank_transfer: "bg-blue-100 text-blue-700 border-blue-200",
  cheque: "bg-violet-100 text-violet-700 border-violet-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

const TYPE_BADGE = {
  deposit: "bg-amber-100 text-amber-700 border-amber-200",
  installment: "bg-blue-100 text-blue-700 border-blue-200",
  final_payment: "bg-emerald-100 text-emerald-700 border-emerald-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

const PAYMENT_TYPES = ["deposit", "installment", "final_payment", "other"];
const PAYMENT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];

const EMPTY_FORM = {
  deal: "", amount: "", paymentType: "installment",
  paymentMethod: "bank_transfer", reference: "",
  paymentDate: todayISO(), notes: "",
};

const LIMIT = 50;

const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const SalePayments = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const confirm = useConfirm();

  const [payments, setPayments] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dealFilter, setDealFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalCollected, setTotalCollected] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [voiding, setVoiding] = useState(null);

  const load = useCallback(async () => {
    if (!biz) return;
    setLoading(true);
    try {
      const params = {
        business: biz, limit: LIMIT, page,
        ...(dealFilter && { deal: dealFilter }),
        ...(typeFilter && { paymentType: typeFilter }),
        ...(methodFilter && { paymentMethod: methodFilter }),
        ...(statusFilter && { status: statusFilter }),
        ...(debouncedSearch && { search: debouncedSearch }),
      };
      const res = await saleApi.listPayments(params);
      const items = Array.isArray(res) ? res : (res?.payments ?? []);
      setPayments(items);
      setTotal(res?.total ?? items.length);
      setTotalCollected(res?.totalCollected ?? 0);
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [biz, page, dealFilter, typeFilter, methodFilter, statusFilter, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!biz) return;
    saleApi.listDeals({ business: biz, limit: 200 })
      .then((res) => setDeals(Array.isArray(res) ? res : (res?.deals ?? [])))
      .catch(() => {});
  }, [biz]);

  const handleDealSelect = (dealId) => {
    setForm((f) => ({ ...f, deal: dealId }));
    setSelectedDeal(deals.find((x) => x._id === dealId) || null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.deal || !form.amount || !form.paymentDate) {
      toast.warn("Deal, amount and payment date are required");
      return;
    }
    setSaving(true);
    try {
      await saleApi.createPayment({ ...form, business: biz });
      toast.success("Payment recorded successfully");
      setShowCreate(false);
      setForm({ ...EMPTY_FORM, paymentDate: todayISO() });
      setSelectedDeal(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async (payment) => {
    if (!await confirm({
      title: "Void Payment",
      message: `Void payment ${payment.paymentNumber} of ${fmtKES(payment.amount)}? This marks it as cancelled and cannot be undone.`,
      confirmText: "Void Payment",
      isDangerous: true,
    })) return;
    setVoiding(payment._id);
    try {
      await saleApi.voidPayment(payment._id, { business: biz });
      toast.success(`Payment ${payment.paymentNumber} voided`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to void payment");
    } finally {
      setVoiding(null);
    }
  };

  const handleDelete = async (payment) => {
    if (!await confirm({
      title: "Delete Payment",
      message: `Permanently delete payment ${payment.paymentNumber}? This cannot be undone.`,
      confirmText: "Delete",
      isDangerous: true,
    })) return;
    try {
      await saleApi.deletePayment(payment._id);
      toast.success("Payment deleted");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete payment");
    }
  };

  const printReceipt = (payment) => {
    const co = currentCompany || {};
    const deal = payment.deal || {};
    const listing = deal.listing || {};
    const buyer = deal.buyer || {};

    const html = `<!DOCTYPE html><html><head><title>Receipt — ${payment.paymentNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;background:#fff}
.page{max-width:148mm;margin:0 auto;padding:14mm 14mm 10mm}
.hdr{border-bottom:3px solid #027333;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-start}
.brand{font-size:20px;font-weight:900;color:#027333;letter-spacing:2px}
.brand img{height:48px;object-fit:contain}
.co-info{text-align:right;font-size:9px;color:#444;line-height:1.7}
.doc-title{text-align:center;margin:12px 0 14px}
.doc-title h1{font-size:20px;font-weight:900;letter-spacing:4px;color:#027333;text-transform:uppercase}
.doc-title p{font-size:9px;color:#555;margin-top:2px}
.receipt-no{background:#027333;color:#fff;padding:8px 14px;border-radius:6px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center}
.receipt-no span{font-weight:900;font-size:14px;font-family:monospace}
.receipt-no small{font-size:9px;opacity:.8}
.amount-box{background:#0B3B2E;color:#fff;border-radius:8px;padding:14px 20px;margin:14px 0;text-align:center}
.amount-box .lbl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.7}
.amount-box .amt{font-size:28px;font-weight:900;font-family:monospace;margin-top:2px}
.voided-banner{background:#dc2626;color:#fff;border-radius:6px;padding:6px 14px;margin-bottom:12px;text-align:center;font-size:11px;font-weight:900;letter-spacing:3px}
.sec{font-size:9px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#027333;border-bottom:1.5px solid #027333;padding-bottom:4px;margin:12px 0 8px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
.f label{font-size:8.5px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}
.f span{font-size:11px;font-weight:600;color:#111;display:block;padding:4px 8px;border:1px solid #e5e7eb;border-radius:4px;background:#fafafa;min-height:24px}
.thanks{text-align:center;margin:16px 0 8px;font-size:13px;font-weight:900;letter-spacing:3px;color:#027333;text-transform:uppercase}
.sig-box{border-top:1.5px solid #333;padding-top:6px;margin-top:24px;max-width:200px}
.sig-box p{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#555;margin-top:2px}
.footer{margin-top:16px;padding-top:8px;border-top:1.5px solid #027333;font-size:8px;color:#777;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="page">
<div class="hdr">
  <div class="brand">${co.logo ? `<img src="${co.logo}" alt="logo"/>` : (co.companyName || "MILIK")}</div>
  <div class="co-info"><strong>${co.companyName || ""}</strong><br/>${co.physicalAddress || co.postalAddress || ""}<br/>${[co.telephone, co.email].filter(Boolean).join(" | ")}</div>
</div>
<div class="doc-title"><h1>Payment Receipt</h1><p>Official Receipt — Property Sale Transaction</p></div>
${payment.status === "cancelled" ? '<div class="voided-banner">⚠ VOIDED / CANCELLED</div>' : ""}
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
  <div class="f"><label>Status</label><span style="text-transform:uppercase;color:${payment.status === "paid" ? "#027333" : "#dc2626"};font-weight:900">${payment.status}</span></div>
</div>
${payment.notes ? `<div class="sec">Notes</div><div style="border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#fafafa;font-size:10.5px">${payment.notes}</div>` : ""}
<div class="thanks">— Received With Thanks —</div>
<div class="sig-box"><br/><p>Authorized Signature</p><p style="color:#111">${co.companyName || ""}</p></div>
<div class="footer">
  This is a computer-generated receipt and is valid without a physical signature.
  &nbsp;|&nbsp; Generated: ${new Date().toLocaleString("en-KE")} &nbsp;|&nbsp; MILIK Property Sales System
</div>
</div></body></html>`;
    const w = window.open("", "_blank", "width=800,height=650");
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  };

  const totalPages = Math.ceil(total / LIMIT) || 1;
  const paidCount = payments.filter((p) => p.status === "paid").length;
  const cancelledCount = payments.filter((p) => p.status === "cancelled").length;

  const resetFilters = () => {
    setDealFilter(""); setTypeFilter(""); setMethodFilter(""); setStatusFilter(""); setSearch(""); setPage(1);
  };
  const hasFilters = dealFilter || typeFilter || methodFilter || statusFilter || search;

  return (
    <PropertySaleShell
      title="Payments"
      subtitle={`${total} payment(s)`}
      action={
        <button
          onClick={() => { setForm({ ...EMPTY_FORM, paymentDate: todayISO() }); setSelectedDeal(null); setShowCreate(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-[#027333] px-3 py-2 text-xs font-bold text-white shadow hover:bg-[#025a28]"
        >
          <FaPlus /> Record Payment
        </button>
      }
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total Payments", value: loading ? "—" : total, cls: "bg-slate-900 text-white" },
            { label: "Confirmed Paid", value: loading ? "—" : paidCount, cls: "bg-emerald-50 border border-emerald-200 text-emerald-900" },
            { label: "Voided", value: loading ? "—" : cancelledCount, cls: "bg-rose-50 border border-rose-200 text-rose-800" },
            { label: "Total Collected", value: loading ? "—" : fmtKES(totalCollected), cls: "bg-[#027333] text-white" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Receipt no..."
            className="h-8 w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs focus:border-[#027333] focus:outline-none"
          />
          <select
            value={dealFilter}
            onChange={(e) => { setDealFilter(e.target.value); setPage(1); }}
            className="h-8 max-w-[180px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-[#027333]"
          >
            <option value="">All Deals</option>
            {deals.map((d) => (
              <option key={d._id} value={d._id}>{d.dealNumber} — {d.listing?.title || d.listing?.listingNumber || ""}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-[#027333]"
          >
            <option value="">All Types</option>
            {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
          </select>
          <select
            value={methodFilter}
            onChange={(e) => { setMethodFilter(e.target.value); setPage(1); }}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-[#027333]"
          >
            <option value="">All Methods</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-[#027333]"
          >
            <option value="">All Statuses</option>
            {["paid", "pending", "cancelled"].map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={resetFilters} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-rose-500 hover:bg-rose-50">
              Clear
            </button>
          )}
          <button onClick={load} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 hover:bg-slate-100">
            Refresh
          </button>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Receipt No.</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Deal</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Property / Buyer</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Type</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Method</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Reference</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Amount</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Date</th>
                  <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right font-black tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400">Loading payments...</td></tr>
                ) : payments.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400">No payments found.{hasFilters && " Try clearing filters."}</td></tr>
                ) : payments.map((p, i) => (
                  <tr
                    key={p._id}
                    className={`border-t border-slate-100 transition ${
                      p.status === "cancelled"
                        ? "bg-rose-50/40 opacity-60 hover:opacity-80"
                        : i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/50 hover:bg-slate-100/40"
                    }`}
                  >
                    <td className="px-3 py-2 font-black text-slate-900">
                      {p.paymentNumber}
                      {p.status === "cancelled" && (
                        <div className="text-[9px] font-black uppercase text-rose-500">voided</div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-700">{p.deal?.dealNumber || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-700">{p.deal?.listing?.title || p.deal?.listing?.listingNumber || "—"}</div>
                      <div className="text-[10px] text-slate-400">{p.deal?.buyer?.fullName || "—"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${TYPE_BADGE[p.paymentType] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {fmtLabel(p.paymentType)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${METHOD_BADGE[p.paymentMethod] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {fmtLabel(p.paymentMethod)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{p.reference || "—"}</td>
                    <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(p.amount)}</td>
                    <td className="px-3 py-2 text-slate-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE") : "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-black ${STATUS_BADGE[p.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => printReceipt(p)}
                          title="Print Receipt"
                          className="rounded px-1.5 py-1 text-[10px] text-slate-500 hover:bg-slate-100"
                        >
                          <FaPrint />
                        </button>
                        {p.status === "paid" && (
                          <button
                            onClick={() => handleVoid(p)}
                            disabled={voiding === p._id}
                            title="Void Payment"
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                          >
                            <FaBan /> Void
                          </button>
                        )}
                        {p.status === "cancelled" && (
                          <button
                            onClick={() => handleDelete(p)}
                            title="Delete"
                            className="rounded px-1.5 py-1 text-[10px] text-rose-500 hover:bg-rose-50"
                          >
                            <FaTimes />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span>{total} payment(s){hasFilters && " (filtered)"}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40 hover:bg-slate-50"
              >Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-slate-200 px-3 py-1 font-semibold disabled:opacity-40 hover:bg-slate-50"
              >Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Payment Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <form onSubmit={handleCreate} className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-5 py-4 text-white">
              <div>
                <div className="text-sm font-black tracking-wide">Record Payment</div>
                <div className="text-[10px] opacity-75">Post a payment against a deal</div>
              </div>
              <button type="button" onClick={() => setShowCreate(false)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">Close</button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5">

              {/* Deal selector */}
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Deal *</label>
                <select value={form.deal} onChange={(e) => handleDealSelect(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                  <option value="">Select active deal</option>
                  {deals.filter((d) => d.status === "active").map((d) => (
                    <option key={d._id} value={d._id}>
                      {d.dealNumber} — {d.listing?.title || d.listing?.listingNumber || ""} ({d.buyer?.fullName || ""})
                    </option>
                  ))}
                </select>
              </div>

              {/* Deal balance summary */}
              {selectedDeal && (
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px]">
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
                    <div className={`mt-0.5 font-black ${(selectedDeal.balance || 0) > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {fmtKES(selectedDeal.balance || selectedDeal.agreedPrice || 0)}
                    </div>
                  </div>
                  <div className="col-span-3">
                    {(() => {
                      const paid = selectedDeal.totalPaid || 0;
                      const total = selectedDeal.agreedPrice || 1;
                      const pct = Math.min(100, Math.round((paid / total) * 100));
                      return (
                        <div>
                          <div className="mb-1 flex justify-between text-[9px] text-slate-400">
                            <span>Payment Progress</span><span>{pct}% paid</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Type + Method */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payment Type *</label>
                  <select value={form.paymentType} onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                    {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payment Method *</label>
                  <select value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
                  </select>
                </div>
              </div>

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Amount (KES) *</label>
                  <AmountInput
                    value={form.amount}
                    onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]"
                    placeholder="e.g. 500,000"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payment Date *</label>
                  <input type="date" value={form.paymentDate}
                    onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" required />
                </div>
              </div>

              {/* Reference — shown for all methods but label adapts */}
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                  {form.paymentMethod === "mpesa" ? "M-Pesa Transaction Code" :
                    form.paymentMethod === "cheque" ? "Cheque No." :
                    form.paymentMethod === "bank_transfer" ? "EFT / Reference No." :
                    "Reference / Transaction ID"}
                </label>
                <input
                  type="text"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder={
                    form.paymentMethod === "mpesa" ? "e.g. QJ1X23ABC4D" :
                    form.paymentMethod === "cheque" ? "e.g. 000123" :
                    form.paymentMethod === "bank_transfer" ? "e.g. RTGS/001/2026" :
                    "Optional reference..."
                  }
                  className={`w-full rounded-lg border px-3 py-2 text-xs font-mono outline-none focus:border-[#027333] ${
                    ["mpesa", "cheque", "bank_transfer"].includes(form.paymentMethod)
                      ? "border-amber-300 bg-amber-50 placeholder:text-amber-400"
                      : "border-slate-200 bg-slate-50"
                  }`}
                />
                {["mpesa", "cheque", "bank_transfer"].includes(form.paymentMethod) && (
                  <div className="mt-1 text-[10px] text-amber-600 font-semibold">
                    Recommended for {fmtLabel(form.paymentMethod)} — used for reconciliation
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Notes</label>
                <textarea rows={2} value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-[#027333] px-5 py-2 text-xs font-bold text-white hover:bg-[#025a28] disabled:opacity-50">
                {saving ? "Saving..." : "Record Payment"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SalePayments;
