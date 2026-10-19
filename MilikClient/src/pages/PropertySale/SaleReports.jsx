import React, { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaExternalLinkAlt } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import { useTerms } from "../../hooks/useTerm";
import { printTabularList } from "../../utils/printKit";
import { POPUP_BLOCKED, exportToExcel, money } from "./salePrint";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { fmtKES, SALE_MONTHS as MONTHS, saleApi } from "../../services/propertySaleApi";

const currentYear = new Date().getFullYear();
const YEAR_OPTS   = Array.from({ length: 6 }, (_, i) => currentYear - i + 1)
  .map((y) => ({ value: String(y), label: String(y) }));

const SaleReports = () => {
  const T = useTerms("saleModule", "saleListings", "saleOffers", "saleDeals");
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [year, setYear] = useTabState("/sale/reports:year", String(currentYear));

  const { data: report, isFetching: loading, refetch, error } = useQuery({
    queryKey: ["sale-report-sales", biz, year],
    queryFn:  () => saleApi.getSalesReport({ business: biz, year }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load sales report"); }, [error]);

  const months = Array.isArray(report?.months) ? report.months : [];
  const totals  = report?.totals || {};

  const monthData = useMemo(
    () => MONTHS.map((mName, idx) => ({ ...(months.find((x) => x.month === idx + 1 || x.monthName === mName) || {}), label: mName, idx })),
    [months]
  );

  // Opens as a tab in the app's own workspace tab strip (TabManager.jsx), not a new browser
  // tab — tabTitle is the hook TabManager reads (location.state.tabTitle) to label it with the
  // actual month instead of falling back to the route's trailing "/8" segment.
  const openMonthTab = (idx) => {
    navigate(`/sale/reports/monthly/${year}/${idx + 1}`, { state: { tabTitle: `${MONTHS[idx]} ${year}` } });
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
      rows: monthData,
      totalsRow: [`TOTALS — ${year}`, String(totals.listings ?? 0), String(totals.offers ?? 0), String(totals.dealsActive ?? 0), String(totals.dealsClosed ?? 0), money(totals.revenue ?? 0), money(totals.commissionsApproved ?? 0)],
    });
    if (!printed) toast.error(POPUP_BLOCKED);
  };

  const [exporting, setExporting] = React.useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportToExcel([
      { label: "Month", value: (m) => m.label },
      { label: T.saleListings, value: (m) => m.listings ?? 0 },
      { label: T.saleOffers, value: (m) => m.offers ?? 0 },
      { label: `Active ${T.saleDeals}`, value: (m) => m.dealsActive ?? 0 },
      { label: `Closed ${T.saleDeals}`, value: (m) => m.dealsClosed ?? 0 },
      { label: "Revenue (KES)", value: (m) => money(m.revenue ?? 0) },
      { label: "Commissions (KES)", value: (m) => money(m.commissionsApproved ?? 0) },
    ], monthData, `sales-report-${year}`);
    setExporting(false);
  };

  const tableCols = useMemo(() => [
    { label: "Month" },
    { label: T.saleListings, align: "right" },
    { label: T.saleOffers, align: "right" },
    { label: `Active ${T.saleDeals}`, align: "right" },
    { label: `Closed ${T.saleDeals}`, align: "right" },
    { label: "Revenue", align: "right" },
    { label: "Commissions", align: "right" },
  ], [T]);

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">
        <SaleFilterBar
          leading={
            !loading && report ? (
              <div className="flex flex-wrap items-center gap-2">
                {[
                  [T.saleListings, totals.listings ?? 0],
                  [T.saleOffers, totals.offers ?? 0],
                  [`Active ${T.saleDeals}`, totals.dealsActive ?? 0],
                  [`Closed ${T.saleDeals}`, totals.dealsClosed ?? 0],
                  ["Revenue", fmtKES(totals.revenue ?? 0)],
                  ["Commissions", fmtKES(totals.commissionsApproved ?? 0)],
                ].map(([lbl, val]) => (
                  <span key={lbl} className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                    {lbl}: <span className="text-slate-900">{val}</span>
                  </span>
                ))}
              </div>
            ) : null
          }
          trailing={
            <>
              <SalePrintButton onClick={printReport} disabled={loading || !report} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || !report} />
              <button
                onClick={() => refetch()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
              >
                {loading ? "…" : "Refresh"}
              </button>
            </>
          }
        >
          <AppSelect value={String(year)} onChange={(v) => setYear(v ?? String(currentYear))} options={YEAR_OPTS} size="sm" />
        </SaleFilterBar>

        {/* Monthly breakdown */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
          <MilikTable
            columns={tableCols}
            rows={monthData}
            rowKey="idx"
            loading={loading && !report}
            empty="No sales activity recorded yet."
            onRowClick={(m) => openMonthTab(m.idx)}
            rowClassName={(m) => {
              const hasActivity = (m.listings || 0) + (m.offers || 0) + (m.dealsActive || 0) + (m.dealsClosed || 0) + (m.revenue || 0) > 0;
              return hasActivity ? "" : "text-slate-400";
            }}
            renderFooter={() => (
              <>
                <td className="px-3 py-1.5 border-r border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">Totals — {year}</td>
                <td className="px-3 py-1.5 border-r border-slate-200 text-right tabular-nums">{totals.listings ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-slate-200 text-right tabular-nums">{totals.offers ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-slate-200 text-right tabular-nums">{totals.dealsActive ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-slate-200 text-right tabular-nums">{totals.dealsClosed ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-slate-200 text-right font-mono tabular-nums">{fmtKES(totals.revenue ?? 0)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtKES(totals.commissionsApproved ?? 0)}</td>
              </>
            )}
            renderRow={(m) => (
              <>
                <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900 normal-case">{m.label}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums">{m.listings ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums">{m.offers ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums">{m.dealsActive ?? 0}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums font-bold text-emerald-700">{(m.dealsClosed ?? 0) > 0 ? m.dealsClosed : (m.dealsClosed ?? 0)}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-slate-900">{(m.revenue ?? 0) > 0 ? fmtKES(m.revenue) : "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600">{(m.commissionsApproved ?? 0) > 0 ? fmtKES(m.commissionsApproved) : "—"}</td>
              </>
            )}
            renderActions={(m) => (
              <button
                type="button"
                onClick={() => openMonthTab(m.idx)}
                className="p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                title="Open monthly detail"
              >
                <FaExternalLinkAlt size={11} />
              </button>
            )}
          />
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default SaleReports;
