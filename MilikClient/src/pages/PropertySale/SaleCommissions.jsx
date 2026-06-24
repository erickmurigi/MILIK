import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaCheck, FaMoneyBillWave, FaPrint } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";

const STATUS_BADGE = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  approved: "bg-blue-100 text-blue-700 border-blue-200",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-100 text-rose-700 border-rose-200",
};

const PAYOUT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];

const EMPTY_PAYOUT = { payoutMethod: "bank_transfer", payoutReference: "", payoutDate: todayISO() };

const LIMIT = 50;

const SaleCommissions = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const confirm = useConfirm();

  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [backendStats, setBackendStats] = useState(null);
  const [showPayout, setShowPayout] = useState(null);
  const [payoutForm, setPayoutForm] = useState(EMPTY_PAYOUT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!biz) return;
    setLoading(true);
    try {
      const params = { business: biz, limit: LIMIT, page, ...(statusFilter && { status: statusFilter }) };
      const res = await saleApi.listCommissions(params);
      setCommissions(res?.commissions ?? []);
      setTotal(res?.total ?? 0);
      if (res?.stats) setBackendStats(res.stats);
    } catch {
      toast.error("Failed to load commissions");
    } finally {
      setLoading(false);
    }
  }, [biz, page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (commission) => {
    if (!await confirm({
      title: "Approve Commission",
      message: `Approve ${commission.commissionNumber} for ${fmtKES(commission.commissionAmount)}?`,
      confirmText: "Approve",
    })) return;
    setSaving(true);
    try {
      await saleApi.updateCommissionStatus(commission._id, { status: "approved", business: biz });
      toast.success("Commission approved");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to approve");
    } finally {
      setSaving(false);
    }
  };

  const handlePayout = async (e) => {
    e.preventDefault();
    if (!payoutForm.payoutMethod || !payoutForm.payoutDate) {
      toast.warn("Payout method and date are required");
      return;
    }
    setSaving(true);
    try {
      await saleApi.updateCommissionStatus(showPayout._id, { status: "paid", ...payoutForm, business: biz });
      toast.success("Commission marked as paid");
      setShowPayout(null);
      setPayoutForm(EMPTY_PAYOUT);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    } finally {
      setSaving(false);
    }
  };

  const printCommission = useCallback((c) => {
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    const fmtAmt = (n) => Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const co = currentCompany?.name || "";
    const rate = `${c.commissionRate}${c.commissionType === "percentage" ? "%" : " KES (flat)"}`;
    const statusClass = c.status === "paid" ? "paid" : c.status === "approved" ? "approved" : "pending";

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
.badge{display:inline-block;padding:3px 10px;font-size:11px;font-weight:bold;border-radius:3px}
.paid{background:#d1fae5;color:#065f46}.approved{background:#dbeafe;color:#1e40af}.pending{background:#fef3c7;color:#92400e}
.amount-box{background:#f0fdf4;border:1px solid #a7f3d0;border-radius:4px;padding:10px 14px;margin:10px 0;text-align:center}
.amount-box .amt{font-size:22px;font-weight:bold;color:#027333}
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
<div class="row"><span class="lbl">Status:</span><span class="val"><span class="badge ${statusClass}">${(c.status || "").toUpperCase()}</span></span></div>
${c.payoutDate ? `<div class="row"><span class="lbl">Payout Date:</span><span class="val">${fmtDate(c.payoutDate)}</span></div>` : ""}
${c.payoutMethod ? `<div class="row"><span class="lbl">Payout Method:</span><span class="val">${esc(c.payoutMethod.replace("_", " ").toUpperCase())}</span></div>` : ""}
${c.payoutReference ? `<div class="row"><span class="lbl">Reference:</span><span class="val">${esc(c.payoutReference)}</span></div>` : ""}
<div class="sig">
  <div class="sig-box">Agent Signature</div>
  <div class="sig-box">Authorized By</div>
</div>
<div class="ft">Generated on ${new Date().toLocaleString("en-KE")} &mdash; ${esc(co)}</div>
</body></html>`;

    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  }, [currentCompany]);

  const { pending, approved, totalDue, totalPaid } = useMemo(() => ({
    pending:  backendStats?.pending?.count  ?? 0,
    approved: backendStats?.approved?.count ?? 0,
    totalDue: (backendStats?.pending?.amount ?? 0) + (backendStats?.approved?.amount ?? 0),
    totalPaid: backendStats?.paid?.amount   ?? 0,
  }), [backendStats]);

  const totalPages = Math.ceil(total / LIMIT) || 1;

  return (
    <PropertySaleShell
      title="Commissions"
      subtitle={`${total} commission(s)`}
    >
      <div className="flex h-full flex-col gap-2">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total", value: loading ? "—" : total, cls: "bg-slate-900 text-white" },
            { label: "Pending Approval", value: loading ? "—" : pending, cls: "bg-amber-50 border border-amber-200 text-amber-900" },
            { label: "Approved / Due", value: loading ? "—" : fmtKES(totalDue), cls: "bg-blue-50 border border-blue-200 text-blue-900" },
            { label: "Total Paid Out", value: loading ? "—" : fmtKES(totalPaid), cls: "bg-[#027333] text-white" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-[#027333]"
          >
            <option value="">All Statuses</option>
            {["pending", "approved", "paid", "cancelled"].map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <button
            onClick={load}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600 hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Comm. No.</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Agent</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Deal</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Rate</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Payout Date</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                  <th className="px-3 py-1 text-left font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Loading...</td></tr>
                ) : commissions.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No commissions found.</td></tr>
                ) : commissions.map((c, idx) => (
                  <tr key={c._id} className={`border-b border-gray-100 transition ${idx % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                    <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{c.commissionNumber}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{c.agent?.fullName || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-700">{c.deal?.dealNumber || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{c.deal?.listing?.title || c.deal?.listing?.listingNumber || "—"}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-bold text-[#027333]">
                      {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(c.commissionAmount)}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">
                      {c.payoutDate ? new Date(c.payoutDate).toLocaleDateString("en-KE") : "—"}
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_BADGE[c.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-1">
                        {c.status === "pending" && (
                          <button
                            onClick={() => handleApprove(c)}
                            disabled={saving}
                            title="Approve Commission"
                            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                          >
                            <FaCheck /> Approve
                          </button>
                        )}
                        {c.status === "approved" && (
                          <button
                            onClick={() => { setShowPayout(c); setPayoutForm({ ...EMPTY_PAYOUT, payoutDate: todayISO() }); }}
                            title="Mark as Paid"
                            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold text-[#027333] hover:bg-emerald-50"
                          >
                            <FaMoneyBillWave /> Pay Out
                          </button>
                        )}
                        {c.status === "paid" && c.payoutReference && (
                          <span className="text-[10px] text-slate-400">Ref: {c.payoutReference}</span>
                        )}
                        <button
                          onClick={() => printCommission(c)}
                          title="Print commission voucher"
                          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100"
                        >
                          <FaPrint /> Print
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">
            <span>{total} commission(s)</span>
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

      {/* Payout Modal */}
      {showPayout && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
          <form onSubmit={handlePayout} className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#027333] px-5 py-4 text-white">
              <div>
                <div className="text-sm font-black tracking-wide">Record Commission Payout</div>
                <div className="text-[10px] opacity-75">{showPayout.commissionNumber} — {showPayout.agent?.fullName || ""}</div>
              </div>
              <button type="button" onClick={() => setShowPayout(null)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">Close</button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Commission Amount</div>
                <div className="text-xl font-black text-emerald-800">{fmtKES(showPayout.commissionAmount)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payout Method *</label>
                  <select value={payoutForm.payoutMethod} onChange={(e) => setPayoutForm((f) => ({ ...f, payoutMethod: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" required>
                    {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payout Date *</label>
                  <input type="date" value={payoutForm.payoutDate} onChange={(e) => setPayoutForm((f) => ({ ...f, payoutDate: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" required />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Reference / Transaction ID</label>
                <input type="text" value={payoutForm.payoutReference}
                  onChange={(e) => setPayoutForm((f) => ({ ...f, payoutReference: e.target.value }))}
                  placeholder="e.g. M-Pesa ref, EFT reference..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#027333]" />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4">
              <button type="button" onClick={() => setShowPayout(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving}
                className="rounded-lg bg-[#027333] px-5 py-2 text-xs font-bold text-white hover:bg-[#025a28] disabled:opacity-50">
                {saving ? "Saving..." : "Confirm Payout"}
              </button>
            </div>
          </form>
        </div>
      )}
    </PropertySaleShell>
  );
};

export default SaleCommissions;
