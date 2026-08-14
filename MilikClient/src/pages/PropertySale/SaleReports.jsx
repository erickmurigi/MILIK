import React, { useEffect, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPrint } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import AppSelect from "../../components/common/AppSelect";
import { fmtKES, SALE_MONTHS as MONTHS, saleApi } from "../../services/propertySaleApi";
const currentYear = new Date().getFullYear();
const YEAR_OPTS   = Array.from({ length: 6 }, (_, i) => currentYear - i + 1)
  .map((y) => ({ value: String(y), label: String(y) }));

const SaleReports = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [year,    setYear]    = useTabState("/sale/reports:year", String(currentYear));
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!biz) return;
    setLoading(true);
    saleApi.getSalesReport({ business: biz, year })
      .then(setReport)
      .catch(() => toast.error("Failed to load sales report"))
      .finally(() => setLoading(false));
  }, [biz, year]);

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
    const co   = currentCompany || {};
    const coName = co.companyName || co.name || "MILIK";

    const rows = MONTHS.map((mName, idx) => {
      const m = monthData[idx];
      const hasActivity = (m.listings||0)+(m.offers||0)+(m.dealsActive||0)+(m.dealsClosed||0)+(m.revenue||0) > 0;
      return `<tr class="${hasActivity ? "" : "muted"}">
        <td>${mName}</td>
        <td>${m.listings ?? 0}</td>
        <td>${m.offers ?? 0}</td>
        <td>${m.dealsActive ?? 0}</td>
        <td>${m.dealsClosed ?? 0}</td>
        <td class="num">${(m.revenue ?? 0) > 0 ? fmtKES(m.revenue) : "—"}</td>
        <td class="num">${(m.commissionsApproved ?? 0) > 0 ? fmtKES(m.commissionsApproved) : "—"}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<title>Property Sales Report — ${year}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Helvetica Neue",Arial,sans-serif;font-size:10.5px;color:#111;background:#fff}
.page{max-width:260mm;margin:0 auto;padding:14mm 16mm 12mm}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0B3B2E;padding-bottom:10px;margin-bottom:14px}
.brand-name{font-size:15px;font-weight:900;letter-spacing:2px;color:#0B3B2E;text-transform:uppercase}
.brand-sub{font-size:8px;color:#888;margin-top:2px;letter-spacing:1px;text-transform:uppercase}
.brand img{height:48px;object-fit:contain}
.co-meta{text-align:right;font-size:9px;color:#555;line-height:1.7}
.report-id{margin-bottom:14px}
.report-id h1{font-size:12px;font-weight:900;letter-spacing:2.5px;text-transform:uppercase;color:#0B3B2E}
.report-id p{font-size:9px;color:#666;margin-top:2px}
.summary-row{display:flex;gap:0;border:1px solid #e5e7eb;margin-bottom:16px}
.summary-cell{flex:1;padding:8px 12px;border-right:1px solid #e5e7eb}
.summary-cell:last-child{border-right:none}
.summary-cell .lbl{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:3px}
.summary-cell .val{font-size:14px;font-weight:900;color:#0B3B2E;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}
thead tr{background:#0B3B2E;color:#fff}
thead th{padding:7px 9px;font-size:8.5px;font-weight:900;letter-spacing:1px;text-transform:uppercase;text-align:right}
thead th:first-child{text-align:left}
tbody tr{border-bottom:1px solid #e5e7eb}
tbody tr:nth-child(even){background:#f9fafb}
tbody tr.muted td{color:#bbb}
tbody td{padding:6px 9px;font-size:10px;text-align:right}
tbody td:first-child{text-align:left;font-weight:600;color:#111}
.num{font-variant-numeric:tabular-nums}
tfoot tr{background:#0B3B2E;color:#fff}
tfoot td{padding:8px 9px;font-size:10px;font-weight:900;text-align:right}
tfoot td:first-child{text-align:left}
.footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;font-size:8px;color:#aaa;display:flex;justify-content:space-between}
@media print{
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4 landscape;margin:10mm}
}
</style></head>
<body><div class="page">
<div class="hdr">
  <div>${co.logo
    ? `<img src="${co.logo}" alt=""/>`
    : `<div class="brand-name">${coName}</div><div class="brand-sub">Property Sales</div>`
  }</div>
  <div class="co-meta">
    <strong>${coName}</strong><br/>
    ${[co.physicalAddress||co.postalAddress, [co.telephone,co.email].filter(Boolean).join(" | "), co.pinNumber?"PIN: "+co.pinNumber:""].filter(Boolean).join("<br/>")}
  </div>
</div>
<div class="report-id">
  <h1>Annual Sales Performance Report</h1>
  <p>Financial Year: ${year} &nbsp;·&nbsp; Generated: ${new Date().toLocaleString("en-KE")}</p>
</div>
<div class="summary-row">
  <div class="summary-cell"><div class="lbl">Listings Created</div><div class="val">${totals.listings??0}</div></div>
  <div class="summary-cell"><div class="lbl">Offers Received</div><div class="val">${totals.offers??0}</div></div>
  <div class="summary-cell"><div class="lbl">Active Deals</div><div class="val">${totals.dealsActive??0}</div></div>
  <div class="summary-cell"><div class="lbl">Deals Closed</div><div class="val">${totals.dealsClosed??0}</div></div>
  <div class="summary-cell"><div class="lbl">Total Revenue</div><div class="val">${fmtKES(totals.revenue??0)}</div></div>
  <div class="summary-cell"><div class="lbl">Commissions</div><div class="val">${fmtKES(totals.commissionsApproved??0)}</div></div>
</div>
<table>
  <thead>
    <tr>
      <th style="text-align:left">Month</th>
      <th>Listings</th><th>Offers</th><th>Active Deals</th><th>Closed Deals</th>
      <th>Revenue (KES)</th><th>Commissions (KES)</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr>
      <td>TOTALS — ${year}</td>
      <td>${totals.listings??0}</td><td>${totals.offers??0}</td>
      <td>${totals.dealsActive??0}</td><td>${totals.dealsClosed??0}</td>
      <td>${fmtKES(totals.revenue??0)}</td><td>${fmtKES(totals.commissionsApproved??0)}</td>
    </tr>
  </tfoot>
</table>
<div class="footer">
  <span>CONFIDENTIAL — MILIK Property Sales System</span>
  <span>Page 1 of 1</span>
</div>
</div></body></html>`;

    const w = window.open("", "_blank", "width=1100,height=720");
    if (!w) { toast.error("Pop-up blocked — allow pop-ups for this site"); return; }
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
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
                ["Listings",    totals.listings    ?? 0, false, false],
                ["Offers",      totals.offers      ?? 0, false, false],
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
                          isCurrent ? "bg-[#0B3B2E] group-hover:bg-[#07271e]"
                          : hasRev  ? "bg-[#027333]/40 group-hover:bg-[#027333]/60"
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
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Listings</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Offers</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Active Deals</th>
                <th className="px-3 py-2 text-right text-[9px] font-black uppercase tracking-wide border-r border-white/10">Closed Deals</th>
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
                        ? "border-slate-100 bg-white hover:bg-[#027333]/5"
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
