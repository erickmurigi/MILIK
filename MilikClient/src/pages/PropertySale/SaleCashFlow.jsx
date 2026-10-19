import React, { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FaChevronDown, FaExclamationTriangle, FaExternalLinkAlt, FaFilter } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import { fmtDate } from "../../utils/dates";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportToExcel, money, printNow, shortDate } from "./salePrint";

const BUCKET_META = [
  { key: "overdue",  label: "Overdue",      tone: "rose" },
  { key: "next30",   label: "Next 30 days", tone: "amber" },
  { key: "next60",   label: "31–60 days",   tone: "blue" },
  { key: "next90",   label: "61–90 days",   tone: "violet" },
  { key: "beyond90", label: "90+ days",     tone: "slate" },
];

// Aging buckets are genuine status, not decoration (the house rule for when color is allowed) —
// same red/amber/blue/violet/slate palette the Receivables Aging and Schedule pages already use.
const TONE = {
  rose:   { bar: "bg-rose-500",   active: "border-rose-500 bg-rose-50 text-rose-700",       text: "text-rose-700" },
  amber:  { bar: "bg-amber-500",  active: "border-amber-500 bg-amber-50 text-amber-700",    text: "text-amber-700" },
  blue:   { bar: "bg-blue-500",   active: "border-blue-500 bg-blue-50 text-blue-700",       text: "text-blue-700" },
  violet: { bar: "bg-violet-500", active: "border-violet-500 bg-violet-50 text-violet-700", text: "text-violet-700" },
  slate:  { bar: "bg-slate-400",  active: "border-slate-400 bg-slate-100 text-slate-700",   text: "text-slate-600" },
};

export default function SaleCashFlow() {
  const T = useTerms("saleDeal", "saleBuyer", "saleListing");
  const navigate = useNavigate();
  const biz = useSelector((s) => s.company?.currentCompany?._id);
  const company = useSelector((s) => s.company?.currentCompany);
  const [periodFilter, setPeriodFilter] = useState(""); // "" = all periods
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const periodBtnRef = useRef(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-cash-flow", biz],
    queryFn:  () => saleApi.getCashFlowForecast({ business: biz }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const total = data?.totalPipeline ?? 0;

  // Flat, print-shaped row list — every bucket's items in one table, each tagged with its
  // period — this is the default view; the period dropdown narrows it, it doesn't gate it.
  const allRows = useMemo(
    () => BUCKET_META.flatMap(({ key, label, tone }) => (data?.[key]?.items ?? []).map((item) => ({ _id: `${key}:${item._id}`, key, period: label, tone, item }))),
    [data]
  );
  const rows = periodFilter ? allRows.filter((r) => r.key === periodFilter) : allRows;
  const footerTotal = periodFilter ? (data?.[periodFilter]?.amount ?? 0) : total;
  const footerCount = periodFilter ? (data?.[periodFilter]?.count ?? 0) : BUCKET_META.reduce((s, { key }) => s + (data?.[key]?.count ?? 0), 0);
  const hasMoreNote = periodFilter
    ? data?.[periodFilter]?.hasMore
    : BUCKET_META.some(({ key }) => data?.[key]?.hasMore);
  const activeMeta = BUCKET_META.find((b) => b.key === periodFilter);

  const printReport = () => {
    const rows = BUCKET_META.flatMap(({ key, label }) => (data?.[key]?.items ?? []).map((item) => ({ period: label, item })));
    const capped = BUCKET_META.some(({ key }) => data?.[key]?.hasMore);
    printNow({
      title: "Cash Flow Forecast",
      subtitle: `Expected instalment collections as at ${shortDate(new Date())}${capped ? " · the longest periods list only their first items, totals cover all" : ""}`,
      company,
      summaryItems: [...BUCKET_META.map(({ key, label }) => [label, money(data?.[key]?.amount)]), ["Total pipeline", money(total)]],
      columns: [
        { label: "Period", value: (r) => r.period },
        { label: "Due Date", value: (r) => shortDate(r.item.dueDate) },
        { label: T.saleDeal, value: (r) => r.item.deal?.dealNumber ?? "—" },
        { label: T.saleBuyer, value: (r) => r.item.deal?.buyer?.fullName ?? "—" },
        { label: T.saleListing, value: (r) => r.item.deal?.listing?.title ?? "—" },
        { label: "Expected (KES)", align: "right", value: (r) => money(r.item.expectedAmount) },
        { label: "Label", value: (r) => r.item.label ?? r.item.description ?? "" },
      ],
      rows,
      totalsRow: ["TOTAL", "", "", "", "", money(total), ""],
    });
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    const rows = BUCKET_META.flatMap(({ key, label }) => (data?.[key]?.items ?? []).map((item) => ({ period: label, item })));
    await exportToExcel([
      { label: "Period", value: (r) => r.period },
      { label: "Due Date", value: (r) => shortDate(r.item.dueDate) },
      { label: T.saleDeal, value: (r) => r.item.deal?.dealNumber ?? "—" },
      { label: T.saleBuyer, value: (r) => r.item.deal?.buyer?.fullName ?? "—" },
      { label: T.saleListing, value: (r) => r.item.deal?.listing?.title ?? "—" },
      { label: "Expected (KES)", value: (r) => money(r.item.expectedAmount) },
      { label: "Label", value: (r) => r.item.label ?? r.item.description ?? "" },
    ], rows, "cash-flow-forecast");
    setExporting(false);
  };

  const tableCols = useMemo(() => [
    { label: "Period" },
    { label: "Due Date" },
    { label: T.saleDeal },
    { label: T.saleBuyer },
    { label: T.saleListing },
    { label: "Expected", align: "right" },
    { label: "Label" },
  ], [T]);

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">
        <SaleFilterBar
          leading={<span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">Pipeline: {fmtKES(total)}</span>}
          onReset={periodFilter ? () => setPeriodFilter("") : undefined}
          trailing={
            <>
              <SalePrintButton onClick={printReport} disabled={isLoading} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={isLoading} />
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
              >
                {isFetching ? "…" : "Refresh"}
              </button>
            </>
          }
        >
          <div className="relative shrink-0">
            <ListToolbar.Button
              ref={periodBtnRef}
              icon={FaFilter}
              variant={periodFilter ? "dark" : "outline"}
              onClick={() => setShowPeriodMenu((o) => !o)}
            >
              {activeMeta?.label || "All Periods"}
              <FaChevronDown size={7} />
            </ListToolbar.Button>
            <ListToolbar.Menu open={showPeriodMenu} onClose={() => setShowPeriodMenu(false)} anchorRef={periodBtnRef} width="w-56">
              <ListToolbar.MenuItem onClick={() => { setPeriodFilter(""); setShowPeriodMenu(false); }} className={!periodFilter ? "bg-[#F1F6F3] font-bold text-[#0B3B2E]" : ""}>
                All Periods
              </ListToolbar.MenuItem>
              {BUCKET_META.map(({ key, label, tone }) => (
                <ListToolbar.MenuItem
                  key={key}
                  onClick={() => { setPeriodFilter(key); setShowPeriodMenu(false); }}
                  className={`justify-between ${periodFilter === key ? "bg-[#F1F6F3] font-bold text-[#0B3B2E]" : ""}`}
                >
                  <span className="flex items-center gap-1.5">
                    {key === "overdue" && (data?.overdue?.count ?? 0) > 0 && <FaExclamationTriangle size={9} className="text-rose-500" />}
                    {label}
                  </span>
                  <span className={`font-mono ${TONE[tone].text}`}>{fmtKES(data?.[key]?.amount)}</span>
                </ListToolbar.MenuItem>
              ))}
            </ListToolbar.Menu>
          </div>
        </SaleFilterBar>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-400">Loading cash flow…</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
            <MilikTable
              columns={tableCols}
              rows={rows}
              loading={false}
              empty={periodFilter ? `No instalments in "${activeMeta?.label}".` : "No upcoming instalments."}
              rowClassName={(r) => (r.key === "overdue" ? "!bg-rose-50/30" : "")}
              renderFooter={() => (
                <>
                  <td className="px-3 py-1.5 border-r border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">Total</td>
                  <td className="px-3 py-1.5 border-r border-slate-200" />
                  <td className="px-3 py-1.5 border-r border-slate-200" />
                  <td className="px-3 py-1.5 border-r border-slate-200" />
                  <td className="px-3 py-1.5 border-r border-slate-200" />
                  <td className="px-3 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums text-slate-900">{fmtKES(footerTotal)}</td>
                  <td className="px-3 py-1.5" />
                </>
              )}
              renderRow={(r) => {
                const item = r.item;
                const isOverdue = r.key === "overdue";
                return (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100">
                      <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-black uppercase ${TONE[r.tone].active}`}>{r.period}</span>
                    </td>
                    <td className={`px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums ${isOverdue ? "font-black text-rose-700" : "text-slate-700"}`}>{fmtDate(item.dueDate)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{item.deal?.dealNumber ?? "—"}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">{item.deal?.buyer?.fullName ?? "—"}</td>
                    <td className="max-w-[160px] truncate px-3 py-1.5 border-r border-gray-100 text-slate-500">{item.deal?.listing?.title ?? "—"}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-slate-900">{fmtKES(item.expectedAmount)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{item.label ?? item.description ?? "—"}</td>
                  </>
                );
              }}
              renderActions={(r) => r.item.deal?._id ? (
                <button
                  onClick={() => navigate("/sale/deals", { state: { openDealId: r.item.deal._id } })}
                  className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  title={`Open ${T.saleDeal.toLowerCase()}`}
                >
                  <FaExternalLinkAlt size={12} />
                </button>
              ) : null}
            />
            {hasMoreNote && (
              <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                Showing the first {rows.length} of {footerCount} items — totals above cover all of them.
              </div>
            )}
          </div>
        )}
      </div>
    </PropertySaleShell>
  );
}
