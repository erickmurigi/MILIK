import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaFileDownload, FaFilePdf, FaSearch, FaSyncAlt, FaTimes } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import { getAPAgingReport } from "../../redux/apiCalls";
import { useTerms } from "../../hooks/useTerm";
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

const STATUS_LABELS = { draft: "Draft", approved: "Approved" };
const STATUS_COLORS  = {
  draft:    "text-slate-600 bg-slate-100",
  approved: "text-blue-700 bg-blue-50",
};

const CATEGORY_LABELS = {
  landlord_maintenance: "Landlord Maint.",
  deposit_refund:       "Deposit Refund",
  landlord_other:       "Landlord Other",
  manager_property:     "Mgr Property",
  company_operational:  "Operational",
  petty_cash_float:     "Petty Cash Float",
  petty_cash_expense:   "Petty Cash Exp.",
};

const PaymentAgedAnalysis = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const businessId = currentCompany?._id;

  const [asOf, setAsOf] = useState(todayString());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useTabState("/accounts/payment-aged-analysis:search", "");
  const [selectedProperty, setSelectedProperty] = useTabState("/accounts/payment-aged-analysis:selectedProperty", "");
  const [selectedStatus, setSelectedStatus] = useTabState("/accounts/payment-aged-analysis:selectedStatus", "");
  const [selectedCategory, setSelectedCategory] = useTabState("/accounts/payment-aged-analysis:selectedCategory", "");

  const { property: termProperty, landlord: termLandlord } = useTerms("property", "landlord");

  const fetchData = useCallback(async (signal) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await getAPAgingReport({ business: businessId, asOf }, signal);
      if (signal?.aborted) return;
      setData(res);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
      toast.error("Failed to load payments report");
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

  const categories = useMemo(() => {
    const set = new Set(allRows.map((r) => r.category).filter(Boolean));
    return [...set].sort();
  }, [allRows]);

  // Stable option objects — avoids busting AppSelect's internal useMemo on every render
  const propertyOptions  = useMemo(() => properties.map((p) => ({ value: p, label: p })), [properties]);
  const categoryOptions  = useMemo(() => categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] || c })), [categories]);

  const filteredRows = useMemo(() => {
    let rows = allRows;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) =>
      r.reference?.toLowerCase().includes(q) ||
      r.narration?.toLowerCase().includes(q) ||
      r.landlordName?.toLowerCase().includes(q)
    );
    if (selectedProperty) rows = rows.filter((r) => r.propertyName === selectedProperty);
    if (selectedStatus)   rows = rows.filter((r) => r.status === selectedStatus);
    if (selectedCategory) rows = rows.filter((r) => r.category === selectedCategory);
    return rows;
  }, [allRows, search, selectedProperty, selectedStatus, selectedCategory]);

  const bucketTotals = useMemo(() => {
    const totals = { all: 0 };
    for (const b of BUCKETS) {
      totals[b.key] = filteredRows
        .filter((r) => r.bucket === b.key)
        .reduce((s, r) => s + (r.amount || 0), 0);
      totals.all += totals[b.key];
    }
    return totals;
  }, [filteredRows]);

  const isFiltered = search.trim() || selectedProperty || selectedStatus || selectedCategory;

  const clearFilters = useCallback(() => {
    setSearch("");
    setSelectedProperty("");
    setSelectedStatus("");
    setSelectedCategory("");
  }, []);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (!filteredRows.length) return toast.info("No data to export");
    const headers = [
      "Reference", "Narration", "Category", "Status", termProperty, termLandlord, "Due Date", "Days Overdue",
      ...BUCKETS.map((b) => b.label),
      "Total Amount (KES)",
    ];
    const csvRows = filteredRows.map((r) => [
      r.reference, r.narration,
      CATEGORY_LABELS[r.category] || r.category,
      STATUS_LABELS[r.status] || r.status,
      r.propertyName, r.landlordName,
      new Date(r.dueDate).toLocaleDateString("en-KE"),
      r.daysOverdue <= 0 ? 0 : r.daysOverdue,
      ...BUCKETS.map((b) => (r.bucket === b.key ? r.amount : "")),
      r.amount,
    ]);
    csvRows.push([
      "TOTAL", "", "", "", "", "", "", "",
      ...BUCKETS.map((b) => bucketTotals[b.key] || ""),
      bucketTotals.all || "",
    ]);
    const csv = [headers, ...csvRows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Payment_Aged_Analysis_${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, bucketTotals, asOf, termProperty, termLandlord]);

  // ── Print PDF ─────────────────────────────────────────────────────────────
  const handlePrintPDF = useCallback(() => {
    const asOfText = new Date(asOf).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
    const printed = printTabularList({
      title: "Payment Aged Analysis",
      subtitle: `As of ${asOfText} · ${filteredRows.length} record${filteredRows.length !== 1 ? "s" : ""}`,
      company: currentCompany,
      columns: [
        { label: "Reference", value: (r) => r.reference },
        { label: "Narration", value: (r) => r.narration },
        { label: `${termProperty} / ${termLandlord}`, value: (r) => `${r.propertyName || ""}${r.landlordName && r.landlordName !== "—" ? ` / ${r.landlordName}` : ""}` },
        { label: "Status", value: (r) => STATUS_LABELS[r.status] || r.status },
        { label: "Due Date", align: "right", value: (r) => new Date(r.dueDate).toLocaleDateString("en-KE") },
        { label: "Days Over", align: "right", value: (r) => (r.daysOverdue <= 0 ? "Current" : `${r.daysOverdue}d`) },
        ...BUCKETS.map((b) => ({ label: b.label, align: "right", value: (r) => (r.bucket === b.key ? fmt(r.amount) : "") })),
      ],
      rows: filteredRows,
      summaryItems: [
        ["Total Pending", fmt(bucketTotals.all)],
        ...BUCKETS.map((b) => [b.label, fmt(bucketTotals[b.key])]),
      ],
      totalsRow: ["Total Pending", "", "", "", "", "", ...BUCKETS.map((b) => (bucketTotals[b.key] > 0 ? fmt(bucketTotals[b.key]) : "—"))],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [filteredRows, bucketTotals, asOf, currentCompany, termProperty, termLandlord]);

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
              width="w-48"
              className="pl-5"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Ref, narration or ${termLandlord.toLowerCase()}…`}
            />
          </div>

          {/* Status toggle */}
          <div className="flex h-[20px] shrink-0 overflow-hidden border border-slate-200 bg-white">
            {["", "draft", "approved"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setSelectedStatus(s)}
                className={`px-2 text-[9px] font-semibold transition-colors ${
                  selectedStatus === s
                    ? "bg-[#0B3B2E] text-white"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s === "" ? "All" : STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {properties.length > 1 && (
            <AppSelect
              value={selectedProperty}
              onChange={(v) => setSelectedProperty(v ?? "")}
              options={propertyOptions}
              placeholder={`All ${termProperty}s`}
              searchable
              clearable
              compact
              className="shrink-0 w-36"
            />
          )}

          {categories.length > 1 && (
            <AppSelect
              value={selectedCategory}
              onChange={(v) => setSelectedCategory(v ?? "")}
              options={categoryOptions}
              placeholder="All Categories"
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
              {filteredRows.length} voucher{filteredRows.length !== 1 ? "s" : ""} · KES {fmt(bucketTotals.all)}
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
              { label: "Reference" },
              { label: "Narration" },
              { label: `${termProperty} / ${termLandlord}` },
              { label: "Status", align: "center" },
              { label: "Due Date", align: "right" },
              { label: "Days Overdue", align: "right" },
              ...BUCKETS.map((b) => ({ label: b.label, align: "right", className: b.headerCls })),
            ]}
            rows={filteredRows}
            rowKey={(row) => row.reference || row._id}
            loading={loading && !allRows.length}
            empty={isFiltered ? "No records match your filters" : "No pending payment vouchers"}
            renderFooter={filteredRows.length > 0 ? () => (
              <>
                <td colSpan={5} className="px-3 py-2 text-xs font-black uppercase text-slate-600">
                  Total Pending
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
                <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-500">{row.reference}</td>
                <td className="max-w-[180px] truncate px-3 py-1 border-r border-gray-100 text-slate-700" title={row.narration}>{row.narration}</td>
                <td className="px-3 py-1 border-r border-gray-100 text-slate-500">
                  {row.propertyName}{row.landlordName && row.landlordName !== "—" ? ` / ${row.landlordName}` : ""}
                </td>
                <td className="px-3 py-1 border-r border-gray-100 text-center">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[row.status] || "border-slate-200 bg-slate-100 text-slate-500"}`}>
                    {STATUS_LABELS[row.status] || row.status}
                  </span>
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
                      ? <span className={`font-semibold ${b.valueCls}`}>{fmt(row.amount)}</span>
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

export default PaymentAgedAnalysis;
