import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPrint, FaRedoAlt, FaUndo } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch, FilterDateRange } from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import SalePrintButton from "./SalePrintButton";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch, printSaleDocument } from "./salePrint";
import { printCommissionStatementById } from "./SaleCommissionStatement";
import AppSelect from "../../components/common/AppSelect";
import SaleExportButton from "./SaleExportButton";
import { fmtDate } from "../../utils/dates";
import MilikTable from "../../components/common/MilikTable";

// Every record here is a real cash disbursement event (one row per partial payout, not per commission) —
// a historical payout log, not a working queue. Agency commissions can never appear here
// (SaleOwnerCommission has no "paid" status — it's the company's own recognized revenue, never disbursed
// to a third party).
const PAGE_SIZE = 50;
const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const payoutCols = (T) => [
  { label: "Comm. No.", width: "10%" },
  { label: T.saleAgent, width: "13%" },
  { label: T.saleDeal, width: "9%" },
  { label: "Property", width: "13%" },
  { label: "WHT", align: "right", width: "9%" },
  { label: "Net Paid", align: "right", width: "11%" },
  { label: "Method", width: "10%" },
  { label: "Reference", width: "12%" },
  { label: "Date", width: "9%" },
];

// One row per actual disbursement (payout event), not per commission — a commission paid off across
// several partial payouts shows every tranche, even while it's still "approved" (not yet fully settled).
const renderPayoutRow = (p) => (
  <>
    <td className="px-3 py-1.5 font-mono font-black text-[#0B3B2E] border-r border-gray-100">
      {p.commissionNumber}
      {p.commissionStatus === "approved" && (
        <span className="ml-1 border border-amber-200 bg-amber-50 px-1 py-0 text-[8px] font-black uppercase text-amber-600">partial</span>
      )}
    </td>
    <td className="px-3 py-1.5 font-bold text-slate-800 border-r border-gray-100">{p.agent?.fullName || "—"}</td>
    <td className="px-3 py-1.5 font-mono font-black text-slate-700 border-r border-gray-100">{p.deal?.dealNumber || "—"}</td>
    <td className="max-w-[130px] truncate px-3 py-1.5 text-slate-500 border-r border-gray-100">{p.listing?.title || p.listing?.listingNumber || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono tabular-nums text-slate-500">
      {fmtKES(p.whtAmount)}
      {p.whtAmount > 0 && p.whtHandledBy === "advocate" && (
        <span className="ml-1 border border-purple-200 bg-purple-50 px-1 py-0 text-[8px] font-black uppercase text-purple-600" title="The advocate self-remits this WHT to KRA — never posted to our own books">
          advocate remits
        </span>
      )}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-emerald-700">{fmtKES(p.netAmount)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100">
      <span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-600">{fmtLabel(p.method)}</span>
      {p.source === "advocate_trust" && (
        <span className="ml-1 border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-teal-600">via trust</span>
      )}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono text-[10px] text-slate-500">{p.reference || "—"}</td>
    <td className="px-3 py-1.5 font-mono tabular-nums text-slate-500">{p.date ? fmtDate(p.date) : "—"}</td>
  </>
);

const SaleCommissionPayouts = () => {
  const T = useTerms("saleAgent", "saleAgents", "saleDeal", "saleDeals");
  const payoutColumns = useMemo(() => payoutCols(T), [T]);
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [search,     setSearch]     = useTabState("/sale/commission-payouts:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [agentFilt,  setAgentFilt]  = useTabState("/sale/commission-payouts:agentFilt", "");
  const [dealFilt,   setDealFilt]   = useTabState("/sale/commission-payouts:dealFilt", "");
  const [dateFrom,   setDateFrom]   = useTabState("/sale/commission-payouts:dateFrom", "");
  const [dateTo,     setDateTo]     = useTabState("/sale/commission-payouts:dateTo", "");
  const [page,       setPage]       = useTabState("/sale/commission-payouts:page", 1);
  const [pageSize,   setPageSize]   = useTabState("/sale/commission-payouts:pageSize", PAGE_SIZE);
  const [actionKey,  setActionKey]  = useState("");

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz, "all"],
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
  const agentsRef = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const dealsRef  = useMemo(() => dealsData?.data  ?? [], [dealsData]);

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-commission-payouts", biz, debouncedSearch, agentFilt, dealFilt, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listCommissionPayouts({
      business: biz, limit: pageSize, page,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(agentFilt    && { agentId: agentFilt }),
      ...(dealFilt     && { dealId:  dealFilt }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
    }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const payouts    = useMemo(() => data?.data ?? [], [data]);
  const total      = data?.total ?? 0;
  const totalPaid  = useMemo(() => payouts.reduce((s, p) => s + Number(p.netAmount ?? 0), 0), [payouts]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ["sale-commission-payouts", biz] }), [queryClient, biz]);

  const handleReverse = useCallback(async (payout) => {
    if (!await confirm({
      title: "Reverse Commission Payout",
      message: `Reverse the payout of ${payout.commissionNumber} (${fmtKES(payout.netAmount)})? This will reverse every tranche's GL entry.`,
      confirmText: "Reverse",
      isDangerous: true,
    })) return;
    setActionKey(`${payout._id}:reverse`);
    try {
      await saleApi.updateCommissionStatus(payout.commissionId, { status: "reversed", business: biz });
      toast.success("Commission payout reversed");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["sale-commissions", biz] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to reverse payout");
    } finally { setActionKey(""); }
  }, [confirm, biz, invalidate, queryClient]);

  const company = useSelector((s) => s.company?.currentCompany);
  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const filters = {
      business: biz,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(agentFilt && { agentId: agentFilt }),
      ...(dealFilt && { dealId: dealFilt }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    };
    const described = [
      agentFilt && agentFilterOptions.find((o) => o.value === agentFilt)?.label,
      dealFilt && dealFilterOptions.find((o) => o.value === dealFilt)?.label,
      (dateFrom || dateTo) && `${dateFrom ? fmtDate(dateFrom) : "…"} – ${dateTo ? fmtDate(dateTo) : "…"}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listCommissionPayouts, filters), ({ rows }) => ({
      title: "Commission Payouts",
      subtitle: described.join(" · ") || "All payouts",
      company,
      columns: [
        { label: "Comm. No.", value: (p) => p.commissionNumber },
        { label: T.saleAgent, value: (p) => p.agent?.fullName || "—" },
        { label: T.saleDeal, value: (p) => p.deal?.dealNumber || "—" },
        { label: "Property", value: (p) => p.listing?.title || p.listing?.listingNumber || "—" },
        { label: "WHT (KES)", align: "right", value: (p) => money(p.whtAmount) },
        { label: "WHT Remitted By", value: (p) => (p.whtAmount > 0 ? (p.whtHandledBy === "advocate" ? "Advocate" : "Agency") : "—") },
        { label: "Net Paid (KES)", align: "right", value: (p) => money(p.netAmount) },
        { label: "Method", value: (p) => fmtLabel(p.method) },
        { label: "Reference", value: (p) => p.reference || "—" },
        { label: "Date", value: (p) => (p.date ? fmtDate(p.date) : "—") },
      ],
      rows,
      totalsRow: ["TOTAL", `${rows.length} payouts`, "", "", money(rows.reduce((s, p) => s + Number(p.whtAmount ?? 0), 0)), "", money(rows.reduce((s, p) => s + Number(p.netAmount ?? 0), 0)), "", "", ""],
    }));
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    const filters = {
      business: biz,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(agentFilt && { agentId: agentFilt }),
      ...(dealFilt && { dealId: dealFilt }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    };
    await exportAfterFetch(() => fetchAllPages(saleApi.listCommissionPayouts, filters), ({ rows }) => ({
      filename: "commission-payouts",
      columns: [
        { label: "Comm. No.", value: (p) => p.commissionNumber },
        { label: T.saleAgent, value: (p) => p.agent?.fullName || "—" },
        { label: T.saleDeal, value: (p) => p.deal?.dealNumber || "—" },
        { label: "Property", value: (p) => p.listing?.title || p.listing?.listingNumber || "—" },
        { label: "WHT (KES)", value: (p) => money(p.whtAmount) },
        { label: "WHT Remitted By", value: (p) => (p.whtAmount > 0 ? (p.whtHandledBy === "advocate" ? "Advocate" : "Agency") : "—") },
        { label: "Net Paid (KES)", value: (p) => money(p.netAmount) },
        { label: "Method", value: (p) => fmtLabel(p.method) },
        { label: "Reference", value: (p) => p.reference || "—" },
        { label: "Date", value: (p) => (p.date ? fmtDate(p.date) : "—") },
      ],
      rows,
    }));
    setExporting(false);
  };

  const resetFilters = () => { setSearch(""); setAgentFilt(""); setDealFilt(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const activeFilterCount = [search, agentFilt, dealFilt, dateFrom, dateTo].filter(Boolean).length;

  const agentFilterOptions = useMemo(() => agentsRef.map((a) => ({ value: a._id, label: `${a.fullName}${a.agentNumber ? ` (${a.agentNumber})` : ""}` })), [agentsRef]);
  const dealFilterOptions  = useMemo(() => dealsRef.map((d) => ({ value: d._id, label: `${d.dealNumber}${d.listing?.title ? ` — ${d.listing.title}` : ""}` })), [dealsRef]);
  const handlePrintStatement = useCallback((e) => {
    const id = e.currentTarget.dataset.id;
    printSaleDocument((win) => printCommissionStatementById(id, { company: currentCompany, T, win }));
  }, [currentCompany, T]);

  const renderPayoutActions = useCallback((p) => (
    <div className="inline-flex items-center gap-1">
      {p.isReversible && (
        <button type="button" onClick={() => handleReverse(p)} disabled={actionKey === `${p._id}:reverse`} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-600 hover:bg-rose-100 disabled:opacity-40" title="Reverse payout GL entry">
          <FaUndo className="text-[8px]" />
        </button>
      )}
      <button type="button" data-id={p.commissionId} onClick={handlePrintStatement} title="Print Commission Statement" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaPrint className="text-[8px]" />
      </button>
    </div>
  ), [handleReverse, handlePrintStatement, actionKey]);

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">

        {/* Filter bar */}
        <SaleFilterBar
          leading={
            <span className="shrink-0 font-mono text-[9px] font-black text-emerald-700">{fmtKES(totalPaid)} on this page</span>
          }
          onReset={resetFilters}
          activeCount={activeFilterCount}
          trailing={
            <>
              <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
              <ListToolbar.Button variant="outline" onClick={invalidate}>
                <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
              </ListToolbar.Button>
            </>
          }
        >
          <FilterSearch
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={`${T.saleAgent}, ${T.saleDeal.toLowerCase()}, comm. no.`}
          />
          <AppSelect
            value={agentFilt}
            onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }}
            options={agentFilterOptions}
            placeholder={`All ${T.saleAgents}`} clearable compact searchable
          />
          <AppSelect
            value={dealFilt}
            onChange={(v) => { setDealFilt(v ?? ""); setPage(1); }}
            options={dealFilterOptions}
            placeholder={`All ${T.saleDeals}`} clearable compact searchable
          />
          <FilterDateRange
            from={dateFrom} to={dateTo}
            onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </SaleFilterBar>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <MilikTable
            columns={payoutColumns}
            rows={payouts}
            loading={loading}
            empty="No commission payouts found."
            minWidth={940}
            renderRow={renderPayoutRow}
            renderActions={renderPayoutActions}
          />

          <PaginationBar
            page={page}
            pages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={isFetching}
            label="payouts"
          />
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default SaleCommissionPayouts;
