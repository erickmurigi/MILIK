import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaCheck, FaMoneyBillWave, FaPrint, FaRedoAlt, FaUndo } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch, FilterDateRange } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";

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


const SaleCommissions = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter,  setStatusFilter]  = useTabState("/sale/commissions:statusFilter", "");
  const [search,        setSearch]        = useTabState("/sale/commissions:search", "");
  const [agentFilt,     setAgentFilt]     = useTabState("/sale/commissions:agentFilt", "");
  const [dealFilt,      setDealFilt]      = useTabState("/sale/commissions:dealFilt", "");
  const [dateFrom,      setDateFrom]      = useTabState("/sale/commissions:dateFrom", "");
  const [dateTo,        setDateTo]        = useTabState("/sale/commissions:dateTo", "");
  const [page,          setPage]          = useTabState("/sale/commissions:page", 1);
  const [pageSize,      setPageSize]      = useTabState("/sale/commissions:pageSize", PAGE_SIZE);
  const [showPayout,    setShowPayout]    = useState(null);
  const [payoutForm,    setPayoutForm]    = useState(EMPTY_PAYOUT);
  const [saving,        setSaving]        = useState(false);
  const [actionKey,     setActionKey]     = useState("");

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
    queryFn:  () => saleApi.listAgents({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const { data: dealsData } = useQuery({
    queryKey: ["sale-deals-ref", biz],
    queryFn:  () => saleApi.listDeals({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const agentsRef = agentsData?.data ?? [];
  const dealsRef  = dealsData?.data  ?? [];

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-commissions", biz, statusFilter, search, agentFilt, dealFilt, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listCommissions({
      business: biz, limit: pageSize, page,
      ...(statusFilter && { status:   statusFilter }),
      ...(search       && { search }),
      ...(agentFilt    && { agentId:  agentFilt }),
      ...(dealFilt     && { dealId:   dealFilt }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
    }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const commissions = data?.data ?? [];
  const total       = data?.total ?? 0;
  const commStats   = data?.stats ?? null;
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
      window.open(`/sale/commissions/${paid._id}/statement`, "_blank");
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
      {/* Stats bar */}
      {commStats && (
        <div className="mb-1 grid grid-cols-4 gap-1">
          {[
            { key: "pending",  label: "Pending",  cls: "border-amber-200 bg-amber-50 text-amber-800" },
            { key: "approved", label: "Approved", cls: "border-blue-200 bg-blue-50 text-blue-800" },
            { key: "paid",     label: "Paid",     cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
            { key: "cancelled",label: "Cancelled",cls: "border-slate-200 bg-slate-50 text-slate-500" },
          ].map(({ key, label, cls }) => (
            <div key={key} className={`border px-3 py-1.5 ${cls}`}>
              <div className="text-[9px] font-black uppercase tracking-widest opacity-70">{label}</div>
              <div className="text-sm font-black">{fmtKES(commStats[key]?.amount ?? 0)}</div>
              <div className="text-[10px] font-bold opacity-60">{commStats[key]?.count ?? 0} record(s)</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <SaleFilterBar
        onReset={() => { setSearch(""); setStatusFilter(""); setAgentFilt(""); setDealFilt(""); setDateFrom(""); setDateTo(""); setPage(1); }}
        activeCount={[search, statusFilter, agentFilt, dealFilt, dateFrom, dateTo].filter(Boolean).length}
      >
        <FilterSearch
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Agent, deal, comm. no."
        />
        <AppSelect value={statusFilter} onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }} options={["pending", "approved", "paid", "cancelled"].map((s) => ({ value: s, label: fmtLabel(s) }))} placeholder="All Statuses" clearable size="sm" />
        <AppSelect value={agentFilt} onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }} options={agentsRef.map((a) => ({ value: a._id, label: `${a.fullName}${a.agentNumber ? ` (${a.agentNumber})` : ""}` }))} placeholder="All Agents" clearable size="sm" searchable />
        <AppSelect value={dealFilt} onChange={(v) => { setDealFilt(v ?? ""); setPage(1); }} options={dealsRef.map((d) => ({ value: d._id, label: `${d.dealNumber}${d.listing?.title ? ` — ${d.listing.title}` : ""}` }))} placeholder="All Deals" clearable size="sm" searchable />
        <FilterDateRange
          from={dateFrom} to={dateTo}
          onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
        />
      </SaleFilterBar>

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
                        onClick={() => window.open(`/sale/commissions/${c._id}/statement`, "_blank")}
                        title="Print Commission Statement"
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
              <AppSelect label="Payout Method *" value={payoutForm.payoutMethod} onChange={(v) => setPayoutForm((f) => ({ ...f, payoutMethod: v ?? "" }))} options={PAYOUT_METHODS.map((m) => ({ value: m, label: fmtLabel(m) }))} size="md" />
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
