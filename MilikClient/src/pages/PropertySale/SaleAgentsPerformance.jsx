import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaChartLine } from "react-icons/fa";
import MilikTable from "../../components/common/MilikTable";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import SaleFilterBar from "./SaleFilterBar";
import { useTerms } from "../../hooks/useTerm";
import SalePrintButton from "./SalePrintButton";
import { money, printNow, shortDate } from "./salePrint";

const statusOpts = (T) => [
  { value: "",         label: `All ${T.saleAgents}` },
  { value: "active",   label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const EMPTY = [];
const ZERO  = { totalDeals: 0, closedDeals: 0, activeDeals: 0, totalRevenue: 0, commPaid: 0, commPending: 0, closeRate: 0 };

const SaleAgentsPerformance = () => {
  const T              = useTerms("saleAgent", "saleAgents");
  const navigate       = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;
  const STATUS_OPTS    = useMemo(() => statusOpts(T), [T]);

  const [statusFilter, setStatusFilter] = useTabState("/sale/agents/performance:status", "active");
  const [sortCol,      setSortCol]      = useState("totalRevenue");
  const [sortDir,      setSortDir]      = useState("desc");

  const { data: agentsData, isLoading: loadingAgents, error: agentsError } = useQuery({
    queryKey: ["sale-agents-perf-list", biz, statusFilter],
    queryFn:  () => saleApi.listAgents({ business: biz, status: statusFilter || undefined, limit: 200 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const { data: perfData, isLoading: loadingPerf } = useQuery({
    queryKey: ["sale-agents-perf", biz],
    queryFn:  () => saleApi.getAgentsPerformance(),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (agentsError) toast.error(`Failed to load ${T.saleAgents.toLowerCase()}`);
  }, [agentsError, T.saleAgents]);

  const agents    = agentsData?.data ?? EMPTY;
  const perfList  = perfData?.agents ?? EMPTY;
  const isLoading = loadingAgents || loadingPerf;

  const rows = useMemo(() => {
    const byAgent = new Map(perfList.map((p) => [String(p.agentId), p]));
    return agents.map((agent) => {
      const p = byAgent.get(String(agent._id)) || ZERO;
      return {
        agent,
        totalDeals:   Number(p.totalDeals   || 0),
        closedDeals:  Number(p.closedDeals  || 0),
        activeDeals:  Number(p.activeDeals  || 0),
        totalRevenue: Number(p.totalRevenue || 0),
        commPaid:     Number(p.commPaid     || 0),
        commPending:  Number(p.commPending  || 0),
        closeRate:    Number(p.closeRate    || 0),
      };
    });
  }, [agents, perfList]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const { totalRevAll, totalCommAll, closedAll } = useMemo(() => ({
    totalRevAll:  rows.reduce((s, r) => s + r.totalRevenue, 0),
    totalCommAll: rows.reduce((s, r) => s + r.commPaid, 0),
    closedAll:    rows.reduce((s, r) => s + r.closedDeals, 0),
  }), [rows]);

  const printReport = () => {
    const status = STATUS_OPTS.find((o) => o.value === statusFilter)?.label;
    printNow({
      title: `${T.saleAgent} Performance`,
      subtitle: `${status || `All ${T.saleAgents}`} · as at ${shortDate(new Date())}`,
      company: currentCompany,
      summaryItems: [
        [T.saleAgents, String(agents.length)],
        ["Closed", String(closedAll)],
        ["Revenue", money(totalRevAll)],
        ["Commission paid", money(totalCommAll)],
      ],
      columns: [
        { label: "#", value: (r) => sorted.indexOf(r) + 1 },
        { label: T.saleAgent, value: (r) => `${r.agent.fullName}${r.agent.agentNumber ? ` (${r.agent.agentNumber})` : ""}` },
        { label: "Status", value: (r) => r.agent.status },
        { label: "Total", align: "right", value: (r) => r.totalDeals },
        { label: "Closed", align: "right", value: (r) => r.closedDeals },
        { label: "Active", align: "right", value: (r) => r.activeDeals },
        { label: "Close %", align: "right", value: (r) => (r.totalDeals > 0 ? `${r.closeRate}%` : "—") },
        { label: "Revenue (KES)", align: "right", value: (r) => money(r.totalRevenue) },
        { label: "Comm. Paid (KES)", align: "right", value: (r) => money(r.commPaid) },
        { label: "Pending (KES)", align: "right", value: (r) => (r.commPending > 0 ? money(r.commPending) : "—") },
      ],
      rows: sorted,
      totalsRow: ["", "TOTAL", "", String(rows.reduce((s, r) => s + r.totalDeals, 0)), String(closedAll), String(rows.reduce((s, r) => s + r.activeDeals, 0)), "", money(totalRevAll), money(totalCommAll), money(rows.reduce((s, r) => s + r.commPending, 0))],
    });
  };

  return (
    <PropertySaleShell>
      {/* Filter */}
      <SaleFilterBar
        leading={
          <>
            <span className="shrink-0 font-mono text-[9px] font-black text-slate-500">{agents.length} {(agents.length === 1 ? T.saleAgent : T.saleAgents).toLowerCase()}</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[9px] font-black text-emerald-700">{closedAll}</span>
            <span className="shrink-0 text-[9px] text-slate-400">closed</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[9px] font-black text-slate-700">{fmtKES(totalRevAll)}</span>
            <span className="shrink-0 text-[9px] text-slate-400">revenue</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[9px] font-black text-slate-700">{fmtKES(totalCommAll)}</span>
            <span className="shrink-0 text-[9px] text-slate-400">comm. paid</span>
          </>
        }
        onReset={() => setStatusFilter("active")}
        trailing={<SalePrintButton onClick={printReport} disabled={isLoading || !sorted.length} />}
        activeCount={statusFilter && statusFilter !== "active" ? 1 : 0}
      >
        <AppSelect
          value={statusFilter}
          onChange={(v) => setStatusFilter(v ?? "")}
          options={STATUS_OPTS}
          placeholder={`All ${T.saleAgents}`}
          clearable
          compact
        />
      </SaleFilterBar>

      {/* Table */}
      <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
        <MilikTable
          columns={[
            { label: T.saleAgent },
            { label: "Status" },
            { label: "Total", sortKey: "totalDeals" },
            { label: "Closed", sortKey: "closedDeals" },
            { label: "Active", sortKey: "activeDeals" },
            { label: "Close %", sortKey: "closeRate" },
            { label: "Revenue", sortKey: "totalRevenue" },
            { label: "Comm. Paid", sortKey: "commPaid" },
            { label: "Pending", sortKey: "commPending" },
          ]}
          rows={sorted}
          loading={isLoading}
          empty={`No ${T.saleAgents.toLowerCase()} found.`}
          sortKey={sortCol}
          sortDir={sortDir}
          onSort={toggleSort}
          renderRow={({ agent, totalDeals, closedDeals, activeDeals, totalRevenue, commPaid, commPending, closeRate }, idx) => (
            <>
              <td className="px-3 py-1.5 border-r border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#0B3B2E]/10 text-[10px] font-black text-[#0B3B2E]">{idx + 1}</div>
                  <div>
                    <div className="font-black text-slate-800">{agent.fullName}</div>
                    <div className="font-mono text-[10px] text-slate-400">{agent.agentNumber}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-1.5 border-r border-gray-100">
                <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-black uppercase ${agent.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{agent.status}</span>
              </td>
              <td className="px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums text-slate-700">{totalDeals}</td>
              <td className="px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums text-emerald-700">{closedDeals}</td>
              <td className="px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums text-blue-700">{activeDeals}</td>
              <td className="px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums text-slate-700">
                {totalDeals > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-16 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-[#0B3B2E]" style={{ width: `${closeRate}%` }} />
                    </div>
                    <span>{closeRate}%</span>
                  </div>
                ) : "—"}
              </td>
              <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black tabular-nums text-slate-900">{fmtKES(totalRevenue)}</td>
              <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black tabular-nums text-emerald-700">{fmtKES(commPaid)}</td>
              <td className="px-3 py-1.5 font-mono tabular-nums">
                {commPending > 0 ? <span className="font-black text-amber-700">{fmtKES(commPending)}</span> : <span className="text-slate-400">—</span>}
              </td>
            </>
          )}
          renderActions={({ agent }) => (
            <button onClick={() => navigate(`/sale/agents/${agent._id}/performance`)} className="flex items-center gap-1 border border-[#0B3B2E]/30 bg-[#0B3B2E]/5 px-2.5 py-1 text-[10px] font-black text-[#0B3B2E] hover:bg-[#0B3B2E]/10" title="View full performance report">
              <FaChartLine className="text-[9px]" /> Report
            </button>
          )}
        />
      </div>
    </PropertySaleShell>
  );
};

export default SaleAgentsPerformance;
