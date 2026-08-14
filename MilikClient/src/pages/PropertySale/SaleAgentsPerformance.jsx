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

const STATUS_OPTS = [
  { value: "",         label: "All Agents" },
  { value: "active",   label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const SaleAgentsPerformance = () => {
  const navigate       = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter, setStatusFilter] = useTabState("/sale/agents/performance:status", "active");
  const [sortCol,      setSortCol]      = useState("totalRevenue");
  const [sortDir,      setSortDir]      = useState("desc");

  const { data: agentsData, isLoading: loadingAgents, error: agentsError } = useQuery({
    queryKey: ["sale-agents-perf-list", biz, statusFilter],
    queryFn:  () => saleApi.listAgents({ business: biz, status: statusFilter || undefined, limit: 500 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const { data: dealsData, isLoading: loadingDeals } = useQuery({
    queryKey: ["sale-agents-perf-deals", biz],
    queryFn:  () => saleApi.listDeals({ limit: 200 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const { data: commsData, isLoading: loadingComms } = useQuery({
    queryKey: ["sale-agents-perf-comms", biz],
    queryFn:  () => saleApi.listCommissions({ limit: 200 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (agentsError) toast.error("Failed to load agents");
  }, [agentsError]);

  const agents      = agentsData?.data ?? [];
  const allDeals    = dealsData?.data  ?? [];
  const allComms    = commsData?.data  ?? [];
  const isLoading   = loadingAgents || loadingDeals || loadingComms;

  const rows = useMemo(() => {
    return agents.map((agent) => {
      const agentDeals = allDeals.filter((d) => d.agent && (d.agent._id || d.agent) === agent._id);
      const agentComms = allComms.filter((c) => c.agent && (c.agent._id || c.agent) === agent._id);

      const totalDeals   = agentDeals.length;
      const closedDeals  = agentDeals.filter((d) => d.status === "closed").length;
      const activeDeals  = agentDeals.filter((d) => d.status === "active").length;
      const totalRevenue = agentDeals.filter((d) => d.status === "closed").reduce((s, d) => s + Number(d.agreedPrice || 0), 0);
      const commPaid     = agentComms.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.commissionAmount || 0), 0);
      const commPending  = agentComms.filter((c) => ["pending", "approved"].includes(c.status)).reduce((s, c) => s + Number(c.commissionAmount || 0), 0);
      const closeRate    = totalDeals > 0 ? Math.round((closedDeals / totalDeals) * 100) : 0;

      return { agent, totalDeals, closedDeals, activeDeals, totalRevenue, commPaid, commPending, closeRate };
    });
  }, [agents, allDeals, allComms]);

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

  const totalRevAll  = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalCommAll = rows.reduce((s, r) => s + r.commPaid, 0);
  const closedAll    = rows.reduce((s, r) => s + r.closedDeals, 0);

  return (
    <PropertySaleShell>
      {/* Filter */}
      <SaleFilterBar
        leading={
          <>
            <span className="shrink-0 font-mono text-[10px] font-black text-slate-500">{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[10px] font-black text-emerald-700">{closedAll}</span>
            <span className="shrink-0 text-[10px] text-slate-400">closed</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[10px] font-black text-slate-700">{fmtKES(totalRevAll)}</span>
            <span className="shrink-0 text-[10px] text-slate-400">revenue</span>
            <span className="shrink-0 select-none text-slate-200">|</span>
            <span className="shrink-0 font-mono text-[10px] font-black text-slate-700">{fmtKES(totalCommAll)}</span>
            <span className="shrink-0 text-[10px] text-slate-400">comm. paid</span>
          </>
        }
        onReset={() => setStatusFilter("active")}
        activeCount={statusFilter && statusFilter !== "active" ? 1 : 0}
      >
        <AppSelect
          value={statusFilter}
          onChange={(v) => setStatusFilter(v ?? "")}
          options={STATUS_OPTS}
          placeholder="All Agents"
          clearable
          size="sm"
        />
      </SaleFilterBar>

      {/* Table */}
      <div className="border border-slate-200 bg-white shadow-sm overflow-hidden">
        <MilikTable
          columns={[
            { label: "Agent" },
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
          empty="No agents found."
          sortKey={sortCol}
          sortDir={sortDir}
          onSort={toggleSort}
          renderRow={({ agent, totalDeals, closedDeals, activeDeals, totalRevenue, commPaid, commPending, closeRate }, idx) => (
            <>
              <td className="px-3 py-1.5 border-r border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#027333]/10 text-[10px] font-black text-[#027333]">{idx + 1}</div>
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
                      <div className="h-full rounded-full bg-[#027333]" style={{ width: `${closeRate}%` }} />
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
            <button onClick={() => navigate(`/sale/agents/${agent._id}/performance`)} className="flex items-center gap-1 border border-[#027333]/30 bg-[#027333]/5 px-2.5 py-1 text-[10px] font-black text-[#027333] hover:bg-[#027333]/10" title="View full performance report">
              <FaChartLine className="text-[9px]" /> Report
            </button>
          )}
        />
      </div>
    </PropertySaleShell>
  );
};

export default SaleAgentsPerformance;
