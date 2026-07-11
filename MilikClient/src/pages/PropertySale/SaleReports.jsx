import React, { useEffect, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPrint } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi } from "../../services/propertySaleApi";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const SaleReports = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useTabState("/sale/reports:year", String(currentYear));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!biz) return;
    setLoading(true);
    saleApi.getSalesReport({ business: biz, year })
      .then((res) => setReport(res))
      .catch(() => toast.error("Failed to load sales report"))
      .finally(() => setLoading(false));
  }, [biz, year]);

  const openMonthTab = (mName, mIdx) => {
    const w = window.open(`/sale/reports/monthly/${year}/${mIdx + 1}`, "_blank");
    if (!w) toast.error("Pop-up blocked — allow pop-ups for this site");
  };

  const months = Array.isArray(report?.months) ? report.months : [];
  const totals = report?.totals || {};

  const printReport = () => {
    const co = currentCompany || {};
    const rows = MONTHS.map((mName, idx) => {
      const m = months.find((x) => x.month === idx + 1 || x.monthName === mName) || {};
      return `<tr>
        <td>${mName}</td>
        <td style="text-align:right">${m.listings ?? 0}</td>
        <td style="text-align:right">${m.offers ?? 0}</td>
        <td style="text-align:right">${m.dealsActive ?? 0}</td>
        <td style="text-align:right">${m.dealsClosed ?? 0}</td>
        <td style="text-align:right;font-weight:700">${(m.revenue ?? 0) > 0 ? fmtKES(m.revenue) : "—"}</td>
        <td style="text-align:right">${(m.commissionsApproved ?? 0) > 0 ? fmtKES(m.commissionsApproved) : "—"}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><title>Sales Report — ${year}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10.5px;color:#1a1a1a;background:#fff}
.page{max-width:297mm;margin:0 auto;padding:16mm 18mm 14mm}
.hdr{border-bottom:3px solid #027333;padding-bottom:10px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start}
.brand{font-size:22px;font-weight:900;color:#027333;letter-spacing:2px}.brand img{height:52px;object-fit:contain}
.co-info{text-align:right;font-size:9.5px;color:#444;line-height:1.7}
.doc-title{text-align:center;margin:14px 0 16px}
.doc-title h1{font-size:18px;font-weight:900;letter-spacing:3px;color:#027333;text-transform:uppercase}
.doc-title p{font-size:10px;color:#555;margin-top:3px}
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.kpi{border:1px solid #e0e7ef;border-radius:6px;padding:10px 12px;background:#f8fafb}
.kpi .lbl{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:3px}
.kpi .val{font-size:16px;font-weight:900;color:#027333}
table{width:100%;border-collapse:collapse}
thead tr{background:#027333;color:#fff}thead th{padding:8px 10px;text-align:left;font-size:9px;font-weight:900;letter-spacing:1px;text-transform:uppercase}
thead th:not(:first-child){text-align:right}
tbody tr{border-bottom:1px solid #e5e7eb}tbody tr:nth-child(even){background:#f8fafb}tbody td{padding:7px 10px;font-size:10px;color:#333}
tfoot tr{background:#0B3B2E;color:#fff}tfoot td{padding:9px 10px;font-size:10px;font-weight:900}tfoot td:not(:first-child){text-align:right}
.footer{margin-top:24px;padding-top:10px;border-top:1.5px solid #027333;font-size:8.5px;color:#777;text-align:center}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4 landscape;margin:12mm}}
</style></head><body><div class="page">
<div class="hdr">
  <div class="brand">${co.logo?`<img src="${co.logo}" alt="logo"/>`:(co.companyName||"MILIK")}</div>
  <div class="co-info"><strong>${co.companyName||""}</strong><br/>${co.physicalAddress||co.postalAddress||""}<br/>${[co.telephone,co.email].filter(Boolean).join(" | ")}<br/>${co.pinNumber?"PIN: "+co.pinNumber:""}</div>
</div>
<div class="doc-title"><h1>Property Sales Report</h1><p>Annual Sales Performance Summary — Financial Year ${year}</p></div>
<div class="kpi-row">
  <div class="kpi"><div class="lbl">Total Listings</div><div class="val">${totals.listings??0}</div></div>
  <div class="kpi"><div class="lbl">Offers Received</div><div class="val">${totals.offers??0}</div></div>
  <div class="kpi"><div class="lbl">Deals Closed</div><div class="val">${totals.dealsClosed??0}</div></div>
  <div class="kpi"><div class="lbl">Total Revenue</div><div class="val">${fmtKES(totals.revenue??0)}</div></div>
</div>
<table>
  <thead><tr><th>Month</th><th style="text-align:right">Listings</th><th style="text-align:right">Offers</th><th style="text-align:right">Active Deals</th><th style="text-align:right">Closed Deals</th><th style="text-align:right">Revenue (KES)</th><th style="text-align:right">Commissions (KES)</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>TOTALS — ${year}</td><td>${totals.listings??0}</td><td>${totals.offers??0}</td><td>${totals.dealsActive??0}</td><td>${totals.dealsClosed??0}</td><td>${fmtKES(totals.revenue??0)}</td><td>${fmtKES(totals.commissionsApproved??0)}</td></tr></tfoot>
</table>
<div class="footer">CONFIDENTIAL | Generated: ${new Date().toLocaleString("en-KE")} | MILIK Property Sales System</div>
</div></body></html>`;
    const w = window.open("", "_blank", "width=1100,height=700");
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  };

  return (
    <PropertySaleShell
      title="Sales Reports"
      subtitle="Annual property sales performance analysis"
      action={
        <button
          onClick={printReport}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <FaPrint /> Print Report
        </button>
      }
    >
      <div className="flex h-full flex-col gap-2">
        {/* Year Selector */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Financial Year</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-[#027333]"
          >
            {Array.from({ length: 6 }, (_, i) => currentYear - i + 1).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="ml-auto text-[10px] text-slate-400">
            Double-click any month row or bar to open detailed breakdown in a new tab
          </span>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Listings Created", value: loading ? "—" : (totals.listings ?? 0), cls: "bg-slate-900 text-white" },
            { label: "Offers Received", value: loading ? "—" : (totals.offers ?? 0), cls: "bg-amber-50 border border-amber-200 text-amber-900" },
            { label: "Deals Closed", value: loading ? "—" : (totals.dealsClosed ?? 0), cls: "bg-emerald-50 border border-emerald-200 text-emerald-900" },
            { label: "Total Revenue", value: loading ? "—" : fmtKES(totals.revenue ?? 0), cls: "bg-[#027333] text-white" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Revenue Bar Chart */}
        {!loading && report && (() => {
          const thisMonth = new Date().getMonth();
          const isCurrentYear = String(year) === String(currentYear);
          const values = MONTHS.map((mName, idx) => {
            const m = months.find((x) => x.month === idx + 1 || x.monthName === mName) || {};
            return m.revenue || 0;
          });
          const maxVal = Math.max(...values, 1);

          return (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Monthly Revenue — {year}</span>
                <span className="text-[10px] font-black text-[#027333]">{fmtKES(totals.revenue ?? 0)} total</span>
              </div>
              <div className="flex h-20 items-end gap-1">
                {MONTHS.map((mName, idx) => {
                  const barH = Math.max(4, Math.round((values[idx] / maxVal) * 100));
                  const isCurrent = isCurrentYear && idx === thisMonth;
                  return (
                    <div
                      key={mName}
                      className="group relative flex flex-1 cursor-pointer flex-col items-center"
                      title={`${mName}: ${fmtKES(values[idx])} — double-click to open detail`}
                      onDoubleClick={() => openMonthTab(mName, idx)}
                    >
                      <div className="flex w-full flex-col-reverse" style={{ height: "64px" }}>
                        <div
                          className={`w-full rounded-t transition-all ${
                            isCurrent ? "bg-[#027333] group-hover:bg-[#025a28]" :
                            values[idx] > 0 ? "bg-emerald-300 group-hover:bg-emerald-400" :
                            "bg-slate-100 group-hover:bg-slate-200"
                          }`}
                          style={{ height: `${barH}%` }}
                        />
                      </div>
                      <div className={`mt-1 text-[8px] font-bold ${isCurrent ? "text-[#027333]" : "text-slate-400"}`}>
                        {mName.slice(0, 3)}
                      </div>
                      {values[idx] > 0 && (
                        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-[9px] font-black text-white shadow-lg group-hover:block">
                          {fmtKES(values[idx])}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Monthly Breakdown Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                <tr>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Month</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Listings</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Offers</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Active Deals</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Closed Deals</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Revenue (KES)</th>
                  <th className="px-3 py-1 text-right font-bold">Commissions (KES)</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Loading report data...</td></tr>
                ) : MONTHS.map((mName, idx) => {
                  const m = months.find((x) => x.month === idx + 1 || x.monthName === mName) || {};
                  const hasActivity = (m.listings||0)+(m.offers||0)+(m.dealsActive||0)+(m.dealsClosed||0)+(m.revenue||0) > 0;
                  return (
                    <tr
                      key={mName}
                      className={`cursor-pointer select-none border-b border-gray-100 transition ${
                        hasActivity
                          ? "bg-white hover:bg-emerald-50/50"
                          : "bg-slate-50/60 text-slate-400 hover:bg-blue-50/40"
                      }`}
                      onDoubleClick={() => openMonthTab(mName, idx)}
                      title="Double-click to open monthly detail in a new tab"
                    >
                      <td className="px-3 py-1 border-r border-gray-100 font-bold">
                        <div className="flex items-center gap-2">
                          {mName}
                          {hasActivity && (
                            <span className="text-[9px] text-slate-300 opacity-0 group-hover:opacity-100 transition">⤢</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right">{m.listings ?? 0}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right">{m.offers ?? 0}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right">{m.dealsActive ?? 0}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-emerald-700">{m.dealsClosed ?? 0}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{(m.revenue ?? 0) > 0 ? fmtKES(m.revenue) : "—"}</td>
                      <td className="px-3 py-1 text-right text-slate-600">{(m.commissionsApproved ?? 0) > 0 ? fmtKES(m.commissionsApproved) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              {!loading && report && (
                <tfoot className="bg-slate-800 text-white">
                  <tr>
                    <td className="px-3 py-1.5 font-black tracking-wide">TOTALS — {year}</td>
                    <td className="px-3 py-1.5 text-right font-black">{totals.listings ?? 0}</td>
                    <td className="px-3 py-1.5 text-right font-black">{totals.offers ?? 0}</td>
                    <td className="px-3 py-1.5 text-right font-black">{totals.dealsActive ?? 0}</td>
                    <td className="px-3 py-1.5 text-right font-black">{totals.dealsClosed ?? 0}</td>
                    <td className="px-3 py-1.5 text-right font-black">{fmtKES(totals.revenue ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right font-black">{fmtKES(totals.commissionsApproved ?? 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default SaleReports;
