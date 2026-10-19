import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import MilikTable from "../../components/common/MilikTable";
import { useTerms } from "../../hooks/useTerm";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import SalePrintButton from "./SalePrintButton";
import SaleExportButton from "./SaleExportButton";
import { exportToExcel, printNow, shortDate } from "./salePrint";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

const LEAD_STATUSES = ["new", "contacted", "qualified", "site_visited", "proposal_sent", "negotiating", "converted", "lost"];
const OFFER_STATUSES = ["pending", "negotiating", "accepted", "rejected", "expired", "withdrawn"];

// Backend returns camelCase keys for multi-word lead statuses.
const LEAD_KEY_MAP = { site_visited: "siteVisited", proposal_sent: "proposalSent" };
const toCamel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const leadCount = (leads, key) => leads[LEAD_KEY_MAP[key] ?? toCamel(key)] ?? leads[key] ?? 0;

// Only genuine win/loss end-states get a status color — the rest (New, Contacted, Qualified...)
// are just pipeline position, not a judgment, so they stay plain text per house convention.
const STATUS_BADGE = { converted: "text-emerald-700 font-bold", accepted: "text-emerald-700 font-bold", lost: "text-rose-600", rejected: "text-rose-600" };

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const statusCols = [{ label: "Status" }, { label: "Count", align: "right" }];

export default function SaleConversionFunnel() {
  const T = useTerms("saleLeads", "saleOffers", "saleDeal", "saleDeals");
  const biz = useSelector((s) => s.company?.currentCompany?._id);
  const company = useSelector((s) => s.company?.currentCompany);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-funnel", biz],
    queryFn:  () => saleApi.getConversionFunnel({ business: biz }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const leads  = data?.leads  ?? {};
  const offers = data?.offers ?? {};
  const deals  = data?.deals  ?? {};
  const rates  = data?.rates  ?? {};
  const baseline = leads.total || 0;

  const stageRows = useMemo(() => [
    { name: T.saleLeads, count: leads.total ?? 0, fromPrev: "Starting point", ofTotal: 100 },
    { name: T.saleOffers, count: offers.total ?? 0, fromPrev: `${rates.leadsToOffers ?? 0}%`, ofTotal: pct(offers.total ?? 0, baseline) },
    { name: T.saleDeals, count: deals.total ?? 0, fromPrev: `${rates.offersToDeals ?? 0}%`, ofTotal: pct(deals.total ?? 0, baseline) },
    { name: `${T.saleDeals} Closed`, count: deals.closed ?? 0, fromPrev: `${rates.dealsToClose ?? 0}%`, ofTotal: pct(deals.closed ?? 0, baseline) },
  ], [T, leads.total, offers.total, deals.total, deals.closed, rates, baseline]);

  const leadStatusRows = useMemo(() => [
    ...LEAD_STATUSES.map((key) => ({ key, label: cap(key), count: leadCount(leads, key) })),
    ...(leads.other > 0 ? [{ key: "other", label: "Custom stages", count: leads.other }] : []),
  ], [leads]);

  const offerStatusRows = useMemo(() => OFFER_STATUSES.map((key) => ({ key, label: cap(key), count: offers[key] ?? 0 })), [offers]);

  const buildFunnelPrintRows = () => [
    ...stageRows.map((r) => ({ name: r.name, count: String(r.count), note: r.fromPrev })),
    ...leadStatusRows.map((r) => ({ name: `   ${T.saleLeads}: ${r.label}`, count: String(r.count), note: "" })),
    ...offerStatusRows.map((r) => ({ name: `   ${T.saleOffers}: ${r.label}`, count: String(r.count), note: "" })),
  ];
  const funnelColumns = [
    { label: "Stage", value: (r) => r.name },
    { label: "Count", value: (r) => r.count },
    { label: "Conversion", value: (r) => r.note },
  ];

  const printReport = () => {
    printNow({
      title: "Conversion Funnel",
      subtitle: `Pipeline from ${T.saleLeads.toLowerCase()} to closed ${T.saleDeals.toLowerCase()} as at ${shortDate(new Date())}`,
      company,
      summaryItems: [
        [`${T.saleLeads} → ${T.saleOffers}`, `${rates.leadsToOffers ?? 0}%`],
        [`${T.saleOffers} → ${T.saleDeals}`, `${rates.offersToDeals ?? 0}%`],
        [`${T.saleDeals} closed`, `${rates.dealsToClose ?? 0}%`],
        [`Active ${T.saleDeal.toLowerCase()} value`, fmtKES(deals.activeValue ?? 0)],
        [`Closed ${T.saleDeal.toLowerCase()} value`, fmtKES(deals.closedValue ?? 0)],
      ],
      columns: [
        { label: "Stage", value: (r) => r.name },
        { label: "Count", align: "right", value: (r) => r.count },
        { label: "Conversion", value: (r) => r.note },
      ],
      rows: buildFunnelPrintRows(),
    });
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    await exportToExcel(funnelColumns, buildFunnelPrintRows(), "conversion-funnel");
    setExporting(false);
  };

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">
        <SaleFilterBar
          leading={
            <div className="flex flex-wrap items-center gap-2">
              {[
                [T.saleLeads, leads.total ?? 0],
                [T.saleOffers, offers.total ?? 0],
                [T.saleDeals, deals.total ?? 0],
                ["Closed", deals.closed ?? 0],
                [`Active ${T.saleDeal} Value`, fmtKES(deals.activeValue ?? 0)],
                [`Closed ${T.saleDeal} Value`, fmtKES(deals.closedValue ?? 0)],
              ].map(([lbl, val]) => (
                <span key={lbl} className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                  {lbl}: <span className="text-slate-900">{val}</span>
                </span>
              ))}
            </div>
          }
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
        />

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-400">Loading funnel…</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {/* Pipeline stages */}
            <div className="flex-none border border-slate-200 bg-white shadow-sm">
              <MilikTable
                columns={[
                  { label: "Stage" },
                  { label: "Count", align: "right" },
                  { label: "Conversion from previous", align: "right" },
                  { label: "% of total", align: "right" },
                ]}
                rows={stageRows}
                rowKey="name"
                loading={false}
                empty="No pipeline activity yet."
                renderRow={(r) => (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900 normal-case">{r.name}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-slate-900">{r.count.toLocaleString()}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right tabular-nums text-slate-600">{r.fromPrev}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{r.ofTotal}%</td>
                  </>
                )}
              />
            </div>

            {/* Status breakdowns */}
            <div className="grid flex-none grid-cols-1 gap-1.5 sm:grid-cols-2">
              <div className="border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-800">{T.saleLeads} by Status</div>
                <MilikTable
                  columns={statusCols}
                  rows={leadStatusRows}
                  rowKey="key"
                  loading={false}
                  empty="No leads yet."
                  renderRow={(r) => (
                    <>
                      <td className={`px-3 py-1.5 border-r border-gray-100 normal-case ${STATUS_BADGE[r.key] || "text-slate-700"}`}>{r.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-900">{r.count.toLocaleString()}</td>
                    </>
                  )}
                />
              </div>

              <div className="border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-800">{T.saleOffers} by Status</div>
                <MilikTable
                  columns={statusCols}
                  rows={offerStatusRows}
                  rowKey="key"
                  loading={false}
                  empty="No offers yet."
                  renderRow={(r) => (
                    <>
                      <td className={`px-3 py-1.5 border-r border-gray-100 normal-case ${STATUS_BADGE[r.key] || "text-slate-700"}`}>{r.label}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-900">{r.count.toLocaleString()}</td>
                    </>
                  )}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </PropertySaleShell>
  );
}
