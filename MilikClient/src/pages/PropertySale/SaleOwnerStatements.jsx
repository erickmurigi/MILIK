import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaCheckCircle, FaFileAlt, FaPrint, FaSyncAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import { useTerms } from "../../hooks/useTerm";
import { printTabularList } from "../../utils/printKit";
import { POPUP_BLOCKED, money, shortDate } from "./salePrint";
import useSaleFormOptions from "../../hooks/useSaleFormOptions";

const todayIso = () => new Date().toISOString().slice(0, 10);
const firstOfMonthIso = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none transition focus:ring-1 border-slate-300 focus:border-[#0B3B2E] focus:ring-[#0B3B2E]/20";

const CATEGORY_LABEL = { proceeds: "Proceeds", company_commission: "Agency Commission", broker_commission: "Broker Commission", expense: "Recharged Expense", owner_payout: "Owner Payout" };
const CATEGORY_BADGE = {
  proceeds:           "border-emerald-200 bg-emerald-50 text-emerald-700",
  company_commission: "border-violet-200 bg-violet-50 text-violet-700",
  broker_commission:  "border-amber-200 bg-amber-50 text-amber-700",
  expense:             "border-slate-200 bg-slate-50 text-slate-600",
  owner_payout:        "border-blue-200 bg-blue-50 text-blue-700",
};

const lineColumns = [
  { label: "Date" }, { label: "Category" }, { label: "Description" },
  { label: "Amount", align: "right" }, { label: "Balance", align: "right" },
];

// A line's description is already shaped "{Plot} — what happened · reference" by the backend
// (ownerStatementService.js) — split off the reference so it can render as a muted trailing detail
// instead of competing with the actual explanation for the reader's attention.
const splitDescription = (description) => {
  const idx = (description || "").lastIndexOf(" · ");
  if (idx === -1) return { headline: description, ref: null };
  return { headline: description.slice(0, idx), ref: description.slice(idx + 3) };
};

const renderLineRow = (row) => {
  const { headline, ref } = splitDescription(row.description);
  return (
    <>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{shortDate(row.transactionDate)}</td>
      <td className="px-3 py-1.5 border-r border-gray-100">
        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${CATEGORY_BADGE[row.category] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
          {CATEGORY_LABEL[row.category] || row.category}
        </span>
      </td>
      <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">
        {headline}
        {ref && <span className="ml-1.5 font-mono text-[10px] text-slate-400">{ref}</span>}
      </td>
      <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-mono tabular-nums ${row.direction === "credit" ? "text-emerald-700" : "text-red-600"}`}>
        {row.direction === "credit" ? "+" : "-"}{fmtKES(row.amount)}
      </td>
      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-slate-900">{fmtKES(row.runningBalance)}</td>
    </>
  );
};

const SaleOwnerStatements = () => {
  const T = useTerms("saleOwner", "saleOwners", "saleOwnerStatement", "saleProject");
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;
  const queryClient = useQueryClient();
  const { ownerFormOptions } = useSaleFormOptions(biz);

  const [ownerId,   setOwnerId]   = useTabState("/sale/owner-statements:owner", "");
  const [projectId, setProjectId] = useTabState("/sale/owner-statements:project", "");
  const [periodStart, setPeriodStart] = useTabState("/sale/owner-statements:from", firstOfMonthIso());
  const [periodEnd,   setPeriodEnd]   = useTabState("/sale/owner-statements:to", todayIso());
  const [statementId, setStatementId] = useTabState("/sale/owner-statements:statementId", "");
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);

  const { data: projectsData } = useQuery({
    queryKey: ["sale-projects-ref", biz],
    queryFn: () => saleApi.listProjects({ business: biz, limit: 200 }),
    enabled: !!biz,
    staleTime: 5 * 60_000,
  });
  const projectOptions = useMemo(
    () => (projectsData?.data ?? [])
      .filter((p) => !ownerId || String(p.owner?._id || p.owner || "") === String(ownerId))
      .map((p) => ({ value: p._id, label: `${p.name} (${p.projectNumber})` })),
    [projectsData, ownerId]
  );

  const { data: statementsData, isFetching: loadingList } = useQuery({
    queryKey: ["sale-owner-statements", biz, ownerId],
    queryFn: () => saleApi.listOwnerStatements({ business: biz, owner: ownerId || undefined, limit: 20 }),
    enabled: !!biz && !!ownerId,
    staleTime: 10_000,
  });
  const statements = statementsData?.data ?? [];

  const { data: statement, isFetching: loadingStatement } = useQuery({
    queryKey: ["sale-owner-statement", biz, statementId],
    queryFn: () => saleApi.getOwnerStatement(statementId),
    enabled: !!biz && !!statementId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sale-owner-statements", biz] });
    if (statementId) queryClient.invalidateQueries({ queryKey: ["sale-owner-statement", biz, statementId] });
  };

  const handleGenerate = async () => {
    if (!ownerId) return toast.warning(`Choose a ${T.saleOwner.toLowerCase()} first`);
    if (!periodStart || !periodEnd) return toast.warning("Choose a period");
    setGenerating(true);
    try {
      const saved = await saleApi.createOwnerStatementDraft({
        owner: ownerId, project: projectId || null, periodStart, periodEnd,
      });
      setStatementId(saved._id);
      invalidate();
      toast.success("Statement draft generated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to generate statement");
    } finally {
      setGenerating(false);
    }
  };

  const handleApprove = async () => {
    if (!statement) return;
    setApproving(true);
    try {
      await saleApi.approveOwnerStatement(statement._id);
      invalidate();
      toast.success("Statement approved — now frozen");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to approve statement");
    } finally {
      setApproving(false);
    }
  };

  const handlePrint = () => {
    if (!statement) return;
    const printed = printTabularList({
      title: `${T.saleOwnerStatement} — ${statement.statementNumber}`,
      subtitle: `${statement.owner?.fullName || ""} · ${shortDate(statement.periodStart)} to ${shortDate(statement.periodEnd)}`,
      company: currentCompany,
      summaryItems: [
        ["Gross proceeds", money(statement.grossProceeds)],
        ["Agency commission", money(statement.companyCommission)],
        ["Broker commission", money(statement.brokerCommission)],
        ["Recharged expenses", money(statement.rechargedExpenses)],
        ["Paid to owner", money(statement.ownerPayouts)],
        ["Net balance", money(statement.netBalance)],
      ],
      columns: [
        { label: "Date", value: (r) => shortDate(r.transactionDate) },
        { label: "Category", value: (r) => CATEGORY_LABEL[r.category] || r.category },
        { label: "Description", value: (r) => r.description },
        { label: "Amount (KES)", align: "right", value: (r) => (r.direction === "credit" ? money(r.amount) : `(${money(r.amount)})`) },
        { label: "Balance (KES)", align: "right", value: (r) => money(r.runningBalance) },
      ],
      rows: statement.lines || [],
      totalsRow: ["", "", "NET BALANCE", "", money(statement.netBalance)],
    });
    if (!printed) toast.warn(POPUP_BLOCKED);
  };

  return (
    <PropertySaleShell>
      <div className="flex flex-col h-full gap-2">
        {/* Generate bar */}
        <div className="flex flex-shrink-0 flex-wrap items-end gap-2 border border-slate-200 bg-white px-3 py-2">
          <div className="w-56">
            <label className={labelClass}>{T.saleOwner}</label>
            <AppSelect value={ownerId} onChange={(v) => { setOwnerId(v ?? ""); setProjectId(""); setStatementId(""); }} options={ownerFormOptions} placeholder={`Choose ${T.saleOwner.toLowerCase()}`} size="sm" searchable clearable />
          </div>
          <div className="w-56">
            <label className={labelClass}>{T.saleProject} (optional)</label>
            <AppSelect value={projectId} onChange={(v) => setProjectId(v ?? "")} options={projectOptions} placeholder="All projects" size="sm" searchable clearable />
          </div>
          <div>
            <label className={labelClass}>From</label>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
          </div>
          <button type="button" onClick={handleGenerate} disabled={generating} className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-60">
            <FaSyncAlt size={10} className={generating ? "animate-spin" : ""} /> {statementId ? "Regenerate Draft" : "Generate Draft"}
          </button>
        </div>

        <div className="flex flex-1 min-h-0 gap-2">
          {/* Past statements */}
          <div className="w-64 flex-shrink-0 overflow-y-auto border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Statements</div>
            {!ownerId ? (
              <div className="p-4 text-center text-xs text-slate-400">Choose a {T.saleOwner.toLowerCase()} to see their statements.</div>
            ) : loadingList ? (
              <div className="p-4 text-center text-xs text-slate-400">Loading…</div>
            ) : statements.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">No statements yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {statements.map((s) => (
                  <button key={s._id} onClick={() => setStatementId(s._id)} className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50 ${statementId === s._id ? "bg-[#F1F6F3]" : ""}`}>
                    <span className="font-mono text-[11px] font-bold text-[#0B3B2E]">{s.statementNumber}</span>
                    <span className="text-[10px] text-slate-500">{shortDate(s.periodStart)} – {shortDate(s.periodEnd)}</span>
                    <span className={`border px-1 py-0.5 text-[9px] font-bold uppercase ${s.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{s.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Current statement */}
          <div className="flex flex-1 min-h-0 flex-col border border-slate-200 bg-white">
            {!statementId ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
                <FaFileAlt size={28} />
                <span className="text-xs">Generate a draft, or pick a statement on the left.</span>
              </div>
            ) : loadingStatement || !statement ? (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-400">Loading…</div>
            ) : (
              <>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <div>
                    <div className="font-mono text-sm font-black text-[#0B3B2E]">{statement.statementNumber}</div>
                    <div className="text-[10px] text-slate-500">{statement.owner?.fullName} · {shortDate(statement.periodStart)} – {shortDate(statement.periodEnd)}{statement.project?.name ? ` · ${statement.project.name}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`border px-2 py-1 text-[10px] font-bold uppercase ${statement.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{statement.status}</span>
                    <button type="button" onClick={handlePrint} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"><FaPrint size={9} /> Print</button>
                    {statement.status === "draft" && (
                      <button type="button" onClick={handleApprove} disabled={approving} className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-2.5 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-60"><FaCheckCircle size={9} /> Approve</button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-6 gap-0 border-b border-slate-100">
                  {[
                    ["Gross proceeds", statement.grossProceeds, ""],
                    ["Agency commission", statement.companyCommission, "text-red-600"],
                    ["Broker commission", statement.brokerCommission, "text-red-600"],
                    ["Recharged expenses", statement.rechargedExpenses, "text-red-600"],
                    ["Paid to owner", statement.ownerPayouts, "text-red-600"],
                    ["Net balance", statement.netBalance, statement.netBalance >= 0 ? "text-emerald-700" : "text-rose-600"],
                  ].map(([label, val, tone], i) => (
                    <div key={label} className={`border-r border-slate-100 px-3 py-2.5 ${i === 5 ? "border-r-0" : ""}`}>
                      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
                      <div className={`mt-0.5 font-mono font-black tabular-nums text-sm ${tone || "text-slate-900"}`}>{fmtKES(val)}</div>
                    </div>
                  ))}
                </div>
                <div className="flex-shrink-0 border-b border-slate-100 bg-[#F8FAF9] px-3 py-1.5 text-[10px] text-slate-500">
                  {statement.netBalance >= 0
                    ? <>Amount currently due to <span className="font-bold text-slate-700">{statement.owner?.fullName}</span> for this period.</>
                    : <>Amount overpaid to <span className="font-bold text-slate-700">{statement.owner?.fullName}</span> for this period — recoverable against a future payout.</>}
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                  <MilikTable columns={lineColumns} rows={statement.lines || []} rowKey="_id" empty="No activity in this period." minWidth={640} renderRow={renderLineRow} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default SaleOwnerStatements;
