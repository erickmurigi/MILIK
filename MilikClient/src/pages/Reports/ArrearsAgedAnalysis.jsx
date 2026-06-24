import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaFileDownload, FaFilePdf, FaSearch, FaSyncAlt, FaTimes } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getARAgingReport } from "../../redux/apiCalls";

const GRN = "#0B3B2E";

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const localDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayString = () => localDateStr(new Date());

const getEndOfLastQuarter = () => {
  const d = new Date();
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m <= 2) return localDateStr(new Date(y, 0, 0));
  if (m <= 5) return localDateStr(new Date(y, 3, 0));
  if (m <= 8) return localDateStr(new Date(y, 6, 0));
  return localDateStr(new Date(y, 9, 0));
};

const PERIOD_PRESETS = (() => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  return [
    { label: "Today",      date: todayString() },
    { label: "Last Month", date: localDateStr(new Date(y, m, 0)) },
    { label: "Last Qtr",   date: getEndOfLastQuarter() },
    { label: "Last Year",  date: localDateStr(new Date(y, 0, 0)) },
  ];
})();

const escapeHtml = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BUCKETS = [
  { key: "current", label: "Current",    headerCls: "text-emerald-700", valueCls: "text-emerald-700", footerCls: "text-emerald-800" },
  { key: "d1_30",   label: "1–30 Days",  headerCls: "text-yellow-600",  valueCls: "text-yellow-700",  footerCls: "text-yellow-700"  },
  { key: "d31_60",  label: "31–60 Days", headerCls: "text-orange-600",  valueCls: "text-orange-600",  footerCls: "text-orange-700"  },
  { key: "d61_90",  label: "61–90 Days", headerCls: "text-red-500",     valueCls: "text-red-600",     footerCls: "text-red-700"     },
  { key: "d90plus", label: "90+ Days",   headerCls: "text-red-800",     valueCls: "text-red-800",     footerCls: "text-red-900"     },
];

const ArrearsAgedAnalysis = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const companyName = String(currentCompany?.companyName || currentCompany?.name || "").trim();
  const businessId = currentCompany?._id;

  const [asOf, setAsOf] = useState(todayString());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProperty, setSelectedProperty] = useState("");

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await getARAgingReport({ business: businessId, asOf });
      setData(res);
    } catch {
      toast.error("Failed to load arrears report");
    } finally {
      setLoading(false);
    }
  }, [businessId, asOf]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived / memoised ────────────────────────────────────────────────────
  const allRows = useMemo(() => data?.rows || [], [data]);

  const properties = useMemo(() => {
    const set = new Set(allRows.map((r) => r.propertyName).filter(Boolean));
    return [...set].sort();
  }, [allRows]);

  const filteredRows = useMemo(() => {
    let rows = allRows;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) =>
      r.tenantName?.toLowerCase().includes(q) ||
      r.invoiceNumber?.toLowerCase().includes(q)
    );
    if (selectedProperty) rows = rows.filter((r) => r.propertyName === selectedProperty);
    return rows;
  }, [allRows, search, selectedProperty]);

  const bucketTotals = useMemo(() => {
    const totals = { all: 0 };
    for (const b of BUCKETS) {
      totals[b.key] = filteredRows
        .filter((r) => r.bucket === b.key)
        .reduce((s, r) => s + (r.outstanding || 0), 0);
      totals.all += totals[b.key];
    }
    return totals;
  }, [filteredRows]);

  const isFiltered = search.trim() || selectedProperty;

  const clearFilters = useCallback(() => {
    setSearch("");
    setSelectedProperty("");
  }, []);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (!filteredRows.length) return toast.info("No data to export");
    const headers = [
      "Invoice #", "Tenant", "Property", "Unit", "Invoice Date", "Due Date", "Days Overdue",
      ...BUCKETS.map((b) => b.label),
      "Total Outstanding (KES)",
    ];
    const csvRows = filteredRows.map((r) => [
      r.invoiceNumber, r.tenantName, r.propertyName, r.unitName,
      new Date(r.invoiceDate).toLocaleDateString("en-KE"),
      new Date(r.dueDate).toLocaleDateString("en-KE"),
      r.daysOverdue <= 0 ? 0 : r.daysOverdue,
      ...BUCKETS.map((b) => (r.bucket === b.key ? r.outstanding : "")),
      r.outstanding,
    ]);
    csvRows.push([
      "TOTAL", "", "", "", "", "", "",
      ...BUCKETS.map((b) => bucketTotals[b.key] || ""),
      bucketTotals.all || "",
    ]);
    const csv = [headers, ...csvRows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Arrears_Aged_Analysis_${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, bucketTotals, asOf]);

  // ── Print PDF ─────────────────────────────────────────────────────────────
  const handlePrintPDF = useCallback(() => {
    const bucketHeaders = BUCKETS.map((b) => `<th class="r">${b.label}</th>`).join("");
    const bodyRows = filteredRows.map((r) => {
      const bucketCells = BUCKETS.map((b) =>
        `<td class="r">${r.bucket === b.key ? fmt(r.outstanding) : ""}</td>`
      ).join("");
      return `<tr>
        <td>${r.invoiceNumber}</td>
        <td>${escapeHtml(r.tenantName)}</td>
        <td>${escapeHtml(r.propertyName)}${r.unitName && r.unitName !== "—" ? ` / ${escapeHtml(r.unitName)}` : ""}</td>
        <td class="r">${new Date(r.dueDate).toLocaleDateString("en-KE")}</td>
        <td class="r">${r.daysOverdue <= 0 ? "Current" : `${r.daysOverdue}d`}</td>
        ${bucketCells}
      </tr>`;
    }).join("");
    const footerCells = BUCKETS.map((b) =>
      `<td class="r">${bucketTotals[b.key] > 0 ? fmt(bucketTotals[b.key]) : "—"}</td>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><title>Arrears Aged Analysis</title>
<style>body{font-family:Arial,sans-serif;font-size:10px;margin:20px;color:#1e293b}
h2{font-size:13px;color:#0B3B2E;margin-bottom:2px}p.sub{font-size:9px;color:#64748b;margin:0 0 10px}
table{width:100%;border-collapse:collapse}
th{background:#f1f5f9;padding:4px 6px;text-align:left;font-size:8px;border-bottom:2px solid #cbd5e1;text-transform:uppercase}
td{padding:3px 6px;border-bottom:1px solid #e2e8f0}
.r{text-align:right}tfoot td{font-weight:700;border-top:2px solid #94a3b8;background:#f8fafc}</style></head>
<body><h2>${escapeHtml(companyName)} — Arrears Aged Analysis</h2>
<p class="sub">As of ${new Date(asOf).toLocaleDateString("en-KE",{day:"2-digit",month:"long",year:"numeric"})} · ${filteredRows.length} record${filteredRows.length !== 1 ? "s" : ""} · KES ${fmt(bucketTotals.all)}</p>
<table>
  <thead><tr>
    <th>Invoice #</th><th>Tenant</th><th>Property / Unit</th><th class="r">Due Date</th><th class="r">Days Over</th>
    ${bucketHeaders}
  </tr></thead>
  <tbody>${bodyRows}</tbody>
  <tfoot><tr>
    <td colspan="5" style="font-size:8px;text-align:right;text-transform:uppercase;font-weight:700">Total Arrears</td>
    ${footerCells}
  </tr></tfoot>
</table>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return toast.error("Pop-ups blocked");
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 400);
  }, [filteredRows, bucketTotals, asOf, companyName]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-gray-50/95 px-4 py-2 backdrop-blur-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">As Of</span>
          <input
            type="date" value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
          />
          {PERIOD_PRESETS.map(({ label, date }) => (
            <button
              key={label}
              onClick={() => setAsOf(date)}
              className={`h-7 rounded px-2.5 text-[10px] font-semibold transition-colors ${
                asOf === date
                  ? "bg-[#0B3B2E] text-white"
                  : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={fetchData} disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <FaSyncAlt size={10} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Refresh"}
          </button>

          <div className="mx-0.5 h-5 w-px bg-slate-200" />

          <div className="relative">
            <FaSearch size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tenant or invoice…"
              className="h-7 w-44 rounded border border-slate-200 bg-white pl-6 pr-2 text-xs text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
            />
          </div>

          {properties.length > 1 && (
            <select
              value={selectedProperty}
              onChange={(e) => setSelectedProperty(e.target.value)}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
            >
              <option value="">All Properties</option>
              {properties.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}

          {isFiltered && (
            <button
              onClick={clearFilters}
              className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-500 hover:border-red-300 hover:text-red-500"
            >
              <FaTimes size={8} /> Clear
            </button>
          )}

          {!loading && allRows.length > 0 && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""} · KES {fmt(bucketTotals.all)}
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={handleExportCSV}
            className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: "#FF8C00" }}
          >
            <FaFileDownload size={10} /> Export CSV
          </button>
          <button
            onClick={handlePrintPDF}
            className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: GRN }}
          >
            <FaFilePdf size={10} /> Print PDF
          </button>
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {loading && !allRows.length ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
              <FaSyncAlt size={12} className="animate-spin" /> Loading…
            </div>
          ) : !filteredRows.length ? (
            <div className="flex h-32 flex-col items-center justify-center text-slate-400">
              <p className="text-sm font-medium">
                {isFiltered ? "No records match your filters" : "No tenant arrears found"}
              </p>
              {isFiltered && (
                <button onClick={clearFilters} className="mt-2 text-xs text-blue-500 hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <table className="min-w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0B3B2E] text-white">
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Invoice #</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                  <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property / Unit</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Due Date</th>
                  <th className="px-3 py-1 text-right font-bold border-r border-white/10">Days Overdue</th>
                  {BUCKETS.map((b, i, arr) => (
                    <th key={b.key} className={`px-3 py-1 text-right font-bold ${b.headerCls} ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>
                      {b.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                    <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-500">{row.invoiceNumber}</td>
                    <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-800">{row.tenantName}</td>
                    <td className="px-3 py-1 border-r border-gray-100 text-slate-500">
                      {row.propertyName}{row.unitName && row.unitName !== "—" ? ` / ${row.unitName}` : ""}
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-500">
                      {new Date(row.dueDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold">
                      {row.daysOverdue <= 0
                        ? <span className="text-emerald-600">Current</span>
                        : <span className={
                            row.daysOverdue > 90 ? "text-red-800" :
                            row.daysOverdue > 60 ? "text-red-500" :
                            row.daysOverdue > 30 ? "text-orange-600" : "text-yellow-600"
                          }>{row.daysOverdue}d</span>
                      }
                    </td>
                    {BUCKETS.map((b, j, arr) => (
                      <td key={b.key} className={`px-3 py-1 text-right font-mono ${j < arr.length - 1 ? 'border-r border-gray-100' : ''}`}>
                        {row.bucket === b.key
                          ? <span className={`font-semibold ${b.valueCls}`}>{fmt(row.outstanding)}</span>
                          : <span className="select-none text-slate-200">—</span>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50">
                  <td colSpan={4} className="px-3 py-2 text-xs font-black uppercase text-slate-600">
                    Total Arrears
                    {isFiltered && (
                      <span className="ml-1 font-normal normal-case text-slate-400">
                        ({filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-black text-slate-700">
                    {fmt(bucketTotals.all)}
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className={`px-3 py-2 text-right font-mono text-sm font-black ${bucketTotals[b.key] > 0 ? b.footerCls : "text-slate-200"}`}>
                      {bucketTotals[b.key] > 0 ? fmt(bucketTotals[b.key]) : "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ArrearsAgedAnalysis;
