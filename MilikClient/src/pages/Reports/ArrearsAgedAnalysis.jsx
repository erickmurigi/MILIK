import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaFileDownload, FaFilePdf, FaSearch, FaSyncAlt, FaTimes } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import { getARAgingReport } from "../../redux/apiCalls";
import printTabularList from "../../utils/printList";

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

const BUCKETS = [
  { key: "current", label: "Current",    headerCls: "text-emerald-700", valueCls: "text-emerald-700", footerCls: "text-emerald-800" },
  { key: "d1_30",   label: "1–30 Days",  headerCls: "text-yellow-600",  valueCls: "text-yellow-700",  footerCls: "text-yellow-700"  },
  { key: "d31_60",  label: "31–60 Days", headerCls: "text-orange-600",  valueCls: "text-orange-600",  footerCls: "text-orange-700"  },
  { key: "d61_90",  label: "61–90 Days", headerCls: "text-red-500",     valueCls: "text-red-600",     footerCls: "text-red-700"     },
  { key: "d90plus", label: "90+ Days",   headerCls: "text-red-800",     valueCls: "text-red-800",     footerCls: "text-red-900"     },
];

const ArrearsAgedAnalysis = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;
  const { tenant: termTenant, unit: termUnit, property: termProperty } = useTerms("tenant", "unit", "property");

  const [asOf, setAsOf] = useState(todayString());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useTabState("/accounts/arrears-aged-analysis:search", "");
  const [selectedProperty, setSelectedProperty] = useTabState("/accounts/arrears-aged-analysis:selectedProperty", "");

  const fetchData = useCallback(async (signal) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await getARAgingReport({ business: businessId, asOf }, signal);
      if (signal?.aborted) return;
      setData(res);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
      toast.error("Failed to load arrears report");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [businessId, asOf]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  // ── Derived / memoised ────────────────────────────────────────────────────
  const allRows = useMemo(() => data?.rows || [], [data]);

  const properties = useMemo(() => {
    const set = new Set(allRows.map((r) => r.propertyName).filter(Boolean));
    return [...set].sort();
  }, [allRows]);

  // Stable option objects — avoids busting AppSelect's internal useMemo on every render
  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p, label: p })), [properties]);

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
      "Invoice #", termTenant, termProperty, termUnit, "Invoice Date", "Due Date", "Days Overdue",
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
    const asOfText = new Date(asOf).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
    const printed = printTabularList({
      title: "Arrears Aged Analysis",
      subtitle: `As of ${asOfText} · ${filteredRows.length} record${filteredRows.length !== 1 ? "s" : ""}`,
      company: currentCompany,
      columns: [
        { label: "Invoice #", value: (r) => r.invoiceNumber },
        { label: termTenant, value: (r) => r.tenantName, bold: true },
        { label: `${termProperty} / ${termUnit}`, value: (r) => `${r.propertyName || ""}${r.unitName && r.unitName !== "—" ? ` / ${r.unitName}` : ""}` },
        { label: "Due Date", align: "right", value: (r) => new Date(r.dueDate).toLocaleDateString("en-KE") },
        { label: "Days Over", align: "right", value: (r) => (r.daysOverdue <= 0 ? "Current" : `${r.daysOverdue}d`) },
        ...BUCKETS.map((b) => ({ label: b.label, align: "right", value: (r) => (r.bucket === b.key ? fmt(r.outstanding) : "") })),
      ],
      rows: filteredRows,
      summaryItems: [
        ["Total Arrears", fmt(bucketTotals.all)],
        ...BUCKETS.map((b) => [b.label, fmt(bucketTotals[b.key])]),
      ],
      totalsRow: ["Total Arrears", "", "", "", "", ...BUCKETS.map((b) => (bucketTotals[b.key] > 0 ? fmt(bucketTotals[b.key]) : "—"))],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [filteredRows, bucketTotals, asOf, currentCompany, termTenant, termProperty, termUnit]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <ListToolbar>
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">As Of</span>
          <ListToolbar.Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          {PERIOD_PRESETS.map(({ label, date }) => (
            <ListToolbar.Button
              key={label}
              variant={asOf === date ? "primary" : "outline"}
              onClick={() => setAsOf(date)}
            >
              {label}
            </ListToolbar.Button>
          ))}
          <ListToolbar.Button onClick={fetchData} disabled={loading}>
            <FaSyncAlt size={7} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Refresh"}
          </ListToolbar.Button>

          <ListToolbar.Divider />

          <div className="relative shrink-0">
            <FaSearch size={8} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <ListToolbar.Input
              width="w-44"
              className="pl-5"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`${termTenant} or invoice…`}
            />
          </div>

          {properties.length > 1 && (
            <AppSelect
              value={selectedProperty}
              onChange={(v) => setSelectedProperty(v ?? "")}
              options={propertyOptions}
              placeholder="All Properties"
              searchable
              clearable
              compact
              className="shrink-0 w-36"
            />
          )}

          {isFiltered && (
            <ListToolbar.Button
              icon={FaTimes}
              variant="outline"
              className="hover:border-red-300 hover:text-red-500"
              onClick={clearFilters}
            >
              Clear
            </ListToolbar.Button>
          )}

          {!loading && allRows.length > 0 && (
            <span className="shrink-0 bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">
              {filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""} · KES {fmt(bucketTotals.all)}
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <ListToolbar.Button icon={FaFileDownload} variant="accent" onClick={handleExportCSV}>
              Export CSV
            </ListToolbar.Button>
            <ListToolbar.Button icon={FaFilePdf} onClick={handlePrintPDF}>
              Print PDF
            </ListToolbar.Button>
          </div>
        </ListToolbar>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
          <MilikTable
            columns={[
              { label: "Invoice #" },
              { label: termTenant },
              { label: `${termProperty} / ${termUnit}` },
              { label: "Due Date", align: "right" },
              { label: "Days Overdue", align: "right" },
              ...BUCKETS.map((b) => ({ label: b.label, align: "right", className: b.headerCls })),
            ]}
            rows={filteredRows}
            rowKey={(row) => row.invoiceNumber || row._id}
            loading={loading && !allRows.length}
            empty={isFiltered ? "No records match your filters" : "No tenant arrears found"}
            renderFooter={filteredRows.length > 0 ? () => (
              <>
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
              </>
            ) : undefined}
            renderRow={(row) => (
              <>
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
                {BUCKETS.map((b) => (
                  <td key={b.key} className="px-3 py-1 border-r border-gray-100 text-right font-mono last:border-r-0">
                    {row.bucket === b.key
                      ? <span className={`font-semibold ${b.valueCls}`}>{fmt(row.outstanding)}</span>
                      : <span className="select-none text-slate-200">—</span>
                    }
                  </td>
                ))}
              </>
            )}
          />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ArrearsAgedAnalysis;
