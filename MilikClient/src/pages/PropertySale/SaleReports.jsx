import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPrint } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import AppSelect from "../../components/common/AppSelect";
import { useTerms } from "../../hooks/useTerm";
import { printTabularList } from "../../utils/printKit";
import { POPUP_BLOCKED, money } from "./salePrint";
import { fmtKES, SALE_MONTHS as MONTHS, saleApi } from "../../services/propertySaleApi";
const currentYear = new Date().getFullYear();
const YEAR_OPTS   = Array.from({ length: 6 }, (_, i) => currentYear - i + 1)
  .map((y) => ({ value: String(y), label: String(y) }));

const SaleReports = () => {
  const T = useTerms("saleModule", "saleListings", "saleOffers", "saleDeals");
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [year,    setYear]    = useTabState("/sale/reports:year", String(currentYear));

  const { data: report, isFetching: loading, error } = useQuery({
    queryKey: ["sale-report-sales", biz, year],
    queryFn:  () => saleApi.getSalesReport({ business: biz, year }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load sales report"); }, [error]);

  const months = Array.isArray(report?.months) ? report.months : [];
  const totals  = report?.totals || {};

  const monthData = MONTHS.map((mName, idx) =>
    months.find((x) => x.month === idx + 1 || x.monthName === mName) || {}
  );

  const openMonthTab = (idx) => {
    const w = window.open(`/sale/reports/monthly/${year}/${idx + 1}`, "_blank");
    if (!w) toast.error("Pop-up blocked — allow pop-ups for this site");
  };

  const printReport = () => {
    const kes = (v) => `KES ${money(v)}`;
    const printed = printTabularList({
      title: "Annual Sales Performance Report",
      subtitle: `Financial Year: ${year}`,
      company: currentCompany,
      summaryItems: [
        [`${T.saleListings} created`, String(totals.listings ?? 0)],
        [`${T.saleOffers} received`, String(totals.offers ?? 0)],
        [`Active ${T.saleDeals}`, String(totals.dealsActive ?? 0)],
        [`${T.saleDeals} closed`, String(totals.dealsClosed ?? 0)],
        ["Total revenue", kes(totals.revenue ?? 0)],
        ["Commissions", kes(totals.commissionsApproved ?? 0)],
      ],
      columns: [
        { label: "Month", value: (m) => m.label },
        { label: T.saleListings, align: "right", value: (m) => m.listings ?? 0 },
        { label: T.saleOffers, align: "right", value: (m) => m.offers ?? 0 },
        { label: `Active ${T.saleDeals}`, align: "right", value: (m) => m.dealsActive ?? 0 },
        { label: `Closed ${T.saleDeals}`, align: "right", value: (m) => m.dealsClosed ?? 0 },
        { label: "Revenue (KES)", align: "right", value: (m) => ((m.revenue ?? 0) > 0 ? money(m.revenue) : "—") },
        { label: "Commissions (KES)", align: "right", value: (m) => ((m.commissionsApproved ?? 0) > 0 ? money(m.commissionsApproved) : "—") },
      ],
      rows: monthData.map((m, idx) => ({ ...m, label: MONTHS[idx] })),
      totalsRow: [`TOTALS — ${year}`, String(totals.listings ?? 0), String(totals.offers ?? 0), String(totals.dealsActive ?? 0), String(totals.dealsClosed ?? 0), money(totals.revenue ?? 0), money(totals.commissionsApproved ?? 0)],
    });
    if (!printed) toast.error(POPUP_BLOCKED);
  };

  // Bar chart values
  const barValues = monthData.map((m) => m.revenue || 0);
  const maxBar    = Math.max(...barValues, 1);
  const thisMonth = new Date().getMonth();
  const isCurrentYear = String(year) === String(currentYear);

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">

        {/* Toolbar: year selector + inline KPI strip + print button all on one line */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Financial Year</span>
            <AppSelect
              value={String(year)}
              onChange={(v) => setYear(v ?? String(currentYear))}
              options={YEAR_OPTS}
              size="sm"
            />
          </div>
          {!loading && report && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-l border-slate-200 pl-4">
              {[
                [T.saleListings,    totals.listings    ?? 0, false, false],
                [T.saleOffers,      totals.offers      ?? 0, false, false],
                ["Active",      totals.dealsActive ?? 0, false, false],
                ["Closed",      totals.dealsClosed ?? 0, true,  false],
                ["Revenue",     fmtKES(totals.revenue             ?? 0), false, true],
                ["Commissions", fmtKES(totals.commissionsApproved ?? 0), false, true],
              ].map(([lbl, val, highlight, mono]) => (
                <div key={lbl} className="flex items-baseline gap-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{lbl}</span>
                  <span className={`text-xs font-black tabular-nums ${highlight ? "text-emerald-700" : "text-slate-800"} ${mono ? "font-mono" : ""}`}>{val}</span>
                </div>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[9px] text-slate-400 sm:block">Double-click any row to open monthly detail</span>
            <button
              onClick={printReport}
              disabled={loading || !report}
              className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-40"
            >
              <FaPrint size={9} /> Print Report
            </button>
          </div>
        </div>

        {/* Revenue Bar Chart */}
        {!loading && report && (
          <div className="shrink-0 border border-slate-200 bg-white px-4 pb-2 pt-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Monthly Revenue — {year}</span>
              <span className="font-mono text-[10px] font-black text-[#0B3B2E]">{fmtKES(totals.revenue ?? 0)} total</span>
            </div>
            <div className="flex h-[72px] items-end gap-0.5">
              {MONTHS.map((mName, idx) => {
                const barH      = Math.max(3, Math.round((barValues[idx] / maxBar) * 100));
                const isCurrent = isCurrentYear && idx === thisMonth;
                const hasRev    = barValues[idx] > 0;
                return (
                  <div
                    key={mName}
                    className="group relative flex flex-1 cursor-pointer flex-col items-center"
                    title={`${mName} ${year}: ${fmtKES(barValues[idx])}`}
                    onDoubleClick={() => openMonthTab(idx)}
                  >
                    <div className="flex w-full flex-col-reverse" style={{ height: 56 }}>
                      <div
                        className={`w-full transition-all ${
                          isCurrent ? "bg-[#0B3B2E] group-hover:bg-[#0A3127]"
                          : hasRev  ? "bg-[#0B3B2E]/40 group-hover:bg-[#0B3B2E]/60"
                          : "bg-slate-100"
                        }`}
                        style={{ height: `${barH}%` }}
                      />
                    </div>
                    <div className={`mt-0.5 text-[7px] font-bold ${isCurrent ? "text-[#0B3B2E]" : "text-slate-400"}`}>
                      {mName.slice(0, 3)}
                    </div>
                    {hasRev && (
                      <div className="pointer-events-none absolute bottom-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap bg-slate-800 px-2 py-0.5 text-[8px] font-black text-white shadow group-hover:block">
                        {fmtKES(barValues[idx])}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly Breakdown Table */}
        <div className="min-h-0 flex-1 overflow-auto border border-slate-200 bg-white">
          <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide border-r border-white/10">Month</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">{T.saleListings}</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">{T.saleOffers}</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Active {T.saleDeals}</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Closed {T.saleDeals}</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Revenue (KES)</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide">Commissions (KES)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Loading report data…</td></tr>
              ) : MONTHS.map((mName, idx) => {
                const m   = monthData[idx];
                const hasActivity = (m.listings||0)+(m.offers||0)+(m.dealsActive||0)+(m.dealsClosed||0)+(m.revenue||0) > 0;
                return (
                  <tr
                    key={mName}
                    className={`cursor-pointer select-none border-b transition ${
                      hasActivity
                        ? "border-slate-100 bg-white hover:bg-[#0A3127]/5"
                        : "border-slate-100 bg-slate-50/60 text-slate-400 hover:bg-slate-50"
                    }`}
                    onDoubleClick={() => openMonthTab(idx)}
                  >
                    <td className="px-3 py-1.5 border-r border-slate-100 font-bold text-slate-800">{mName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{m.listings ?? 0}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{m.offers ?? 0}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right tabular-nums">{m.dealsActive ?? 0}</td>
                    <td className={`px-3 py-1.5 border-r border-slate-100 text-right tabular-nums font-black ${hasActivity && (m.dealsClosed||0) > 0 ? "text-emerald-700" : ""}`}>
                      {m.dealsClosed ?? 0}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono font-black tabular-nums text-slate-900">
                      {(m.revenue ?? 0) > 0 ? fmtKES(m.revenue) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600">
                      {(m.commissionsApproved ?? 0) > 0 ? fmtKES(m.commissionsApproved) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!loading && report && (
              <tfoot className="bg-[#0B3B2E] text-white">
                <tr>
                  <td className="px-3 py-2 font-black tracking-wide text-[10px]">TOTALS — {year}</td>
                  <td className="px-3 py-2 text-right font-black tabular-nums">{totals.listings ?? 0}</td>
                  <td className="px-3 py-2 text-right font-black tabular-nums">{totals.offers ?? 0}</td>
                  <td className="px-3 py-2 text-right font-black tabular-nums">{totals.dealsActive ?? 0}</td>
                  <td className="px-3 py-2 text-right font-black tabular-nums">{totals.dealsClosed ?? 0}</td>
                  <td className="px-3 py-2 text-right font-mono font-black tabular-nums">{fmtKES(totals.revenue ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono font-black tabular-nums">{fmtKES(totals.commissionsApproved ?? 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

      </div>
    </PropertySaleShell>
  );
};

export default SaleReports;
