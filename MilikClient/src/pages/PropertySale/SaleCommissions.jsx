import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaCheck, FaMoneyBillWave, FaPrint, FaRedoAlt, FaSearch, FaTimes, FaUndo } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";

const STATUS_BADGE = {
  pending:   "border-amber-200 bg-amber-50 text-amber-700",
  approved:  "border-blue-200 bg-blue-50 text-blue-700",
  paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-600",
  reversed:  "border-slate-200 bg-slate-50 text-slate-500",
};

const PAYOUT_METHODS  = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const EMPTY_PAYOUT    = { payoutMethod: "bank_transfer", payoutReference: "", payoutDate: todayISO() };
const PAGE_SIZE       = 50;

const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const Modal = ({ title, subtitle, headerCls = "bg-[#0B3B2E]", children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:p-4">
    <div className="flex w-full flex-col bg-white shadow-2xl sm:max-w-md sm:border sm:border-slate-200 max-h-[92dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-none">
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

const SaleCommissions = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter,  setStatusFilter]  = useTabState("/sale/commissions:statusFilter", "");
  const [search,        setSearch]        = useTabState("/sale/commissions:search", "");
  const [page,          setPage]          = useTabState("/sale/commissions:page", 1);
  const [pageSize,      setPageSize]      = useTabState("/sale/commissions:pageSize", PAGE_SIZE);
  const [showPayout,    setShowPayout]    = useState(null);
  const [payoutForm,    setPayoutForm]    = useState(EMPTY_PAYOUT);
  const [saving,        setSaving]        = useState(false);
  const [actionKey,     setActionKey]     = useState("");

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-commissions", biz, statusFilter, search, page, pageSize],
    queryFn:  () => saleApi.listCommissions({
      business: biz, limit: pageSize, page,
      ...(statusFilter && { status: statusFilter }),
      ...(search       && { search }),
    }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const commissions = data?.commissions ?? data?.data ?? [];
  const total       = data?.total       ?? 0;
  const totalPages  = Math.max(1, Math.ceil(total / pageSize));

  const invalidate  = () => queryClient.invalidateQueries({ queryKey: ["sale-commissions", biz] });

  const handleApprove = async (commission) => {
    if (!await confirm({ title: "Approve Commission", message: `Approve ${commission.commissionNumber} for ${fmtKES(commission.commissionAmount)}?`, confirmText: "Approve" })) return;
    setActionKey(`${commission._id}:approve`);
    try {
      await saleApi.updateCommissionStatus(commission._id, { status: "approved", business: biz });
      toast.success("Commission approved");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to approve");
    } finally {
      setActionKey("");
    }
  };

  const handlePayout = async () => {
    if (!payoutForm.payoutMethod || !payoutForm.payoutDate) { toast.warn("Payout method and date are required"); return; }
    setSaving(true);
    try {
      await saleApi.updateCommissionStatus(showPayout._id, { status: "paid", ...payoutForm, business: biz });
      toast.success("Commission marked as paid");
      const paid = { ...showPayout, status: "paid", ...payoutForm };
      setShowPayout(null);
      setPayoutForm(EMPTY_PAYOUT);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
      printCommission(paid);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    } finally {
      setSaving(false);
    }
  };

  const handleReverse = async (commission) => {
    if (!await confirm({
      title: "Reverse Commission Payout",
      message: `Reverse the payout of ${commission.commissionNumber} (${fmtKES(commission.commissionAmount)})? This will reverse the GL entry for the payout.`,
      confirmText: "Reverse",
      isDangerous: true,
    })) return;
    setActionKey(`${commission._id}:reverse`);
    try {
      await saleApi.updateCommissionStatus(commission._id, { status: "reversed", business: biz });
      toast.success("Commission payout reversed");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to reverse payout");
    } finally {
      setActionKey("");
    }
  };

  const printCommission = (c) => {
    const esc       = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmtDate   = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    const fmtAmt    = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const co        = currentCompany?.companyName || currentCompany?.name || "";
    const rate      = `${c.commissionRate}${c.commissionType === "percentage" ? "%" : " KES (flat)"}`;
    const statusCls = c.status === "paid" ? "paid" : c.status === "approved" ? "approved" : "pending";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Commission ${esc(c.commissionNumber)}</title>
<style>
@page{size:A5;margin:14mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:0;padding:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.c{text-align:center}.h1{font-size:18px;font-weight:bold;margin:0 0 2px}.sub{font-size:11px;color:#555;margin:0}
hr{border:none;margin:8px 0}.s{border-top:1px solid #ccc}.d{border-top:1px dashed #ccc}
.title{font-size:13px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px;margin:6px 0}
.row{display:flex;justify-content:space-between;align-items:center;margin:5px 0;gap:8px}
.lbl{font-weight:bold;color:#555;flex-shrink:0}.val{text-align:right}
.badge{display:inline-block;padding:3px 10px;font-size:11px;font-weight:bold}
.paid{background:#d1fae5;color:#065f46}.approved{background:#dbeafe;color:#1e40af}.pending{background:#fef3c7;color:#92400e}
.amount-box{background:#f0fdf4;border:1px solid #a7f3d0;padding:10px 14px;margin:10px 0;text-align:center}
.amount-box .amt{font-size:22px;font-weight:bold;color:#0B3B2E}
.amount-box .lbl2{font-size:10px;color:#555;margin-bottom:2px}
.sig{display:flex;gap:20px;margin-top:20px}
.sig-box{flex:1;border-top:1px solid #555;padding-top:4px;text-align:center;font-size:10px;color:#555}
.ft{text-align:center;font-size:10px;color:#888;margin-top:12px}
</style></head><body>
<div class="c"><div class="h1">${esc(co)}</div></div>
<hr class="s"/><div class="title">Commission Voucher</div><hr class="s"/>
<div class="row"><span class="lbl">Commission No.:</span><span class="val"><strong>${esc(c.commissionNumber)}</strong></span></div>
<div class="row"><span class="lbl">Date Issued:</span><span class="val">${fmtDate(c.createdAt)}</span></div>
<hr class="d"/>
<div class="row"><span class="lbl">Agent:</span><span class="val">${esc(c.agent?.fullName || "—")}</span></div>
<div class="row"><span class="lbl">Deal No.:</span><span class="val">${esc(c.deal?.dealNumber || "—")}</span></div>
<div class="row"><span class="lbl">Property:</span><span class="val">${esc(c.deal?.listing?.title || c.deal?.listing?.listingNumber || "—")}</span></div>
<div class="row"><span class="lbl">Commission Rate:</span><span class="val">${esc(rate)}</span></div>
<div class="amount-box">
  <div class="lbl2">Commission Amount</div>
  <div class="amt">KES ${fmtAmt(c.commissionAmount)}</div>
</div>
<hr class="d"/>
<div class="row"><span class="lbl">Status:</span><span class="val"><span class="badge ${statusCls}">${(c.status || "").toUpperCase()}</span></span></div>
${c.payoutDate ? `<div class="row"><span class="lbl">Payout Date:</span><span class="val">${fmtDate(c.payoutDate)}</span></div>` : ""}
${c.payoutMethod ? `<div class="row"><span class="lbl">Method:</span><span class="val">${esc(c.payoutMethod.replace("_", " ").toUpperCase())}</span></div>` : ""}
${c.payoutReference ? `<div class="row"><span class="lbl">Reference:</span><span class="val">${esc(c.payoutReference)}</span></div>` : ""}
<div class="sig"><div class="sig-box">Agent Signature</div><div class="sig-box">Authorized By</div></div>
<div class="ft">Generated ${new Date().toLocaleString("en-KE")} — ${esc(co)}</div>
</body></html>`;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  };

  return (
    <PropertySaleShell
      title="Commissions"
      subtitle={`${total} commission(s)`}
      action={
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-commissions", biz] })}
          className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
        >
          <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      {/* Filter bar */}
      <div className="mb-1 flex flex-wrap items-center gap-1 border border-slate-200 bg-white px-2 py-1 shadow-sm">
        <div className="relative min-w-[160px] flex-1">
          <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Agent, deal, comm. no."
            className="h-7 w-full border border-slate-300 pl-7 pr-2 text-xs placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="h-7 border border-[#B7C9C0] bg-[#F1F6F3] px-1.5 text-xs font-semibold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
        >
          <option value="">All Statuses</option>
          {["pending", "approved", "paid", "cancelled"].map((s) => <option key={s} value={s}>{fmtLabel(s)}</option>)}
        </select>
        {(search || statusFilter) && (
          <button type="button" onClick={() => { setSearch(""); setStatusFilter(""); setPage(1); }} className="h-7 border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-100">Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[760px] text-xs border-collapse">
            <thead>
              <tr className="bg-[#0B3B2E]">
                {["Comm. No.", "Agent", "Deal", "Property", "Rate", "Amount", "Payout Date", "Status", "Actions"].map((h) => (
                  <th key={h} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400">Loading…</td></tr>
              ) : commissions.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400">No commissions found.</td></tr>
              ) : commissions.map((c) => (
                <tr key={c._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">{c.commissionNumber}</td>
                  <td className="px-3 py-2 text-slate-700">{c.agent?.fullName || "—"}</td>
                  <td className="px-3 py-2 font-bold text-slate-700">{c.deal?.dealNumber || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{c.deal?.listing?.title || c.deal?.listing?.listingNumber || "—"}</td>
                  <td className="px-3 py-2 font-black text-[#0B3B2E]">
                    {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
                  </td>
                  <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(c.commissionAmount)}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {c.payoutDate ? new Date(c.payoutDate).toLocaleDateString("en-KE") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[c.status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="inline-flex items-center gap-1">
                      {c.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => handleApprove(c)}
                          disabled={!!actionKey}
                          className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-40"
                        >
                          <FaCheck className="inline mr-0.5 text-[9px]" /> Approve
                        </button>
                      )}
                      {c.status === "approved" && (
                        <button
                          type="button"
                          onClick={() => { setShowPayout(c); setPayoutForm(EMPTY_PAYOUT); }}
                          className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                        >
                          <FaMoneyBillWave className="inline mr-0.5 text-[9px]" /> Pay
                        </button>
                      )}
                      {c.status === "paid" && c.payoutReference && (
                        <span className="text-[10px] font-mono text-slate-400">{c.payoutReference}</span>
                      )}
                      {c.status === "paid" && (
                        <button
                          type="button"
                          onClick={() => handleReverse(c)}
                          disabled={actionKey === `${c._id}:reverse`}
                          className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-40"
                          title="Reverse payout GL entry"
                        >
                          <FaUndo className="text-[9px]" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => printCommission(c)}
                        className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
                      >
                        <FaPrint className="text-[9px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} loading={isFetching} />
      </div>

      {/* Payout Modal */}
      {showPayout && (
        <Modal
          title={`Payout — ${showPayout.commissionNumber}`}
          subtitle={`${showPayout.agent?.fullName || ""} · ${fmtKES(showPayout.commissionAmount)}`}
          onClose={() => setShowPayout(null)}
          footer={
            <>
              <button type="button" onClick={() => setShowPayout(null)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handlePayout} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : "Confirm Payout"}
              </button>
            </>
          }
        >
          <div className="mb-3 border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Commission Amount</div>
            <div className="text-xl font-black text-emerald-800">{fmtKES(showPayout.commissionAmount)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payout Method *</label>
              <select
                value={payoutForm.payoutMethod}
                onChange={(e) => setPayoutForm((f) => ({ ...f, payoutMethod: e.target.value }))}
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none"
                required
              >
                {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{fmtLabel(m)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payout Date *</label>
              <input
                type="date"
                value={payoutForm.payoutDate}
                onChange={(e) => setPayoutForm((f) => ({ ...f, payoutDate: e.target.value }))}
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Reference / Transaction ID</label>
              <input
                type="text"
                value={payoutForm.payoutReference}
                onChange={(e) => setPayoutForm((f) => ({ ...f, payoutReference: e.target.value }))}
                placeholder="e.g. M-Pesa ref, EFT reference…"
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs font-mono focus:border-[#0B3B2E] focus:outline-none"
              />
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
};

export default SaleCommissions;
