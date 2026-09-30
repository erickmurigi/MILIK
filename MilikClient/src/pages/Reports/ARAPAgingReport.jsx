import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useTerms } from "../../hooks/useTerm";
import {
  FaFileDownload, FaFilePdf, FaSyncAlt,
} from "react-icons/fa";
import { printTabularList } from "../../utils/printList";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikTable from "../../components/common/MilikTable";
import { getARAgingReport, getAPAgingReport } from "../../redux/apiCalls";

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

const BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30",   label: "1–30 days" },
  { key: "d31_60",  label: "31–60 days" },
  { key: "d61_90",  label: "61–90 days" },
  { key: "d90plus", label: "90+ days" },
];

const BUCKET_COLORS = {
  current: "text-emerald-700 bg-emerald-50",
  d1_30:   "text-yellow-700 bg-yellow-50",
  d31_60:  "text-orange-700 bg-orange-50",
  d61_90:  "text-red-600 bg-red-50",
  d90plus: "text-red-800 bg-red-100 font-bold",
};

// ─── Aging Table ─────────────────────────────────────────────────────────────
const AgingTable = React.memo(({ rows, totals, type, loading }) => {
  const isAR = type === "ar";
  const { tenant: termTenant, unit: termUnit, property: termProperty, landlord: termLandlord } = useTerms("tenant", "unit", "property", "landlord");

  return (
    <MilikTable
      columns={isAR ? [
        { label: "Invoice #" },
        { label: termTenant },
        { label: `${termProperty} / ${termUnit}` },
        { label: "Due Date", align: "right" },
        { label: "Days Over", align: "right" },
        { label: "Bucket", align: "right" },
        { label: "Amount (KES)", align: "right" },
      ] : [
        { label: "Reference" },
        { label: "Narration" },
        { label: `${termProperty} / ${termLandlord}` },
        { label: "Due Date", align: "right" },
        { label: "Days Over", align: "right" },
        { label: "Bucket", align: "right" },
        { label: "Amount (KES)", align: "right" },
      ]}
      rows={rows}
      rowKey={(row) => row.invoiceNumber || row.reference || row._id}
      loading={loading}
      empty={`No outstanding ${isAR ? "tenant arrears" : "pending payments"}`}
      renderFooter={rows.length > 0 ? () => (
        <>
          <td colSpan={3} className="px-3 py-2 text-xs font-black uppercase text-slate-600">Totals</td>
          <td colSpan={3} />
          <td className="px-3 py-2 text-right font-mono text-sm">{fmt(totals?.total)}</td>
        </>
      ) : undefined}
      renderRow={(row) => (
        <>
          {isAR ? (
            <>
              <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-700">{row.invoiceNumber}</td>
              <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{row.tenantName}</td>
              <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{row.propertyName} / {row.unitName}</td>
            </>
          ) : (
            <>
              <td className="px-3 py-1 border-r border-gray-100 font-mono text-slate-700">{row.reference}</td>
              <td className="max-w-[200px] truncate px-3 py-1 border-r border-gray-100 text-slate-700">{row.narration}</td>
              <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{row.propertyName} / {row.landlordName}</td>
            </>
          )}
          <td className="px-3 py-1 border-r border-gray-100 text-right text-slate-500">
            {new Date(row.dueDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
          </td>
          <td className="px-3 py-1 border-r border-gray-100 text-right font-medium text-slate-700">
            {row.daysOverdue <= 0 ? "—" : row.daysOverdue}
          </td>
          <td className="px-3 py-1 border-r border-gray-100 text-right">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${BUCKET_COLORS[row.bucket]}`}>
              {BUCKETS.find((b) => b.key === row.bucket)?.label}
            </span>
          </td>
          <td className="px-3 py-1 text-right font-mono font-semibold text-slate-800">
            {fmt(isAR ? row.outstanding : row.amount)}
          </td>
        </>
      )}
    />
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────
const ARAPAgingReport = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const companyName = String(currentCompany?.companyName || currentCompany?.name || "").trim();
  const { tenant: termTenant, unit: termUnit, property: termProperty, landlord: termLandlord } = useTerms("tenant", "unit", "property", "landlord");

  const [tab, setTab] = useState("ar");
  const [asOf, setAsOf] = useState(todayString());

  const [arData, setArData] = useState(null);
  const [apData, setApData] = useState(null);
  const [loading, setLoading] = useState(false);

  const businessId = currentCompany?._id;

  const fetchData = useCallback(async (signal) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [ar, ap] = await Promise.all([
        getARAgingReport({ business: businessId, asOf }, signal),
        getAPAgingReport({ business: businessId, asOf }, signal),
      ]);
      if (signal?.aborted) return;
      setArData(ar);
      setApData(ap);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
      toast.error("Failed to load aging report");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [businessId, asOf]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  const activeData = tab === "ar" ? arData : apData;
  const rows = activeData?.rows || [];
  const totals = activeData?.totals || {};

  // ── CSV Export ──────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (!rows.length) return toast.info("No data to export");
    const isAR = tab === "ar";
    const headers = isAR
      ? ["Invoice #", termTenant, termProperty, termUnit, "Invoice Date", "Due Date", "Days Overdue", "Bucket", "Amount", "Applied", "Outstanding"]
      : ["Reference", "Narration", "Category", "Status", termProperty, termLandlord, "Due Date", "Days Overdue", "Bucket", "Amount"];

    const dataRows = rows.map((r) =>
      isAR
        ? [r.invoiceNumber, r.tenantName, r.propertyName, r.unitName,
            new Date(r.invoiceDate).toLocaleDateString("en-KE"),
            new Date(r.dueDate).toLocaleDateString("en-KE"),
            r.daysOverdue, r.bucket, r.amount, r.applied, r.outstanding]
        : [r.reference, r.narration, r.category, r.status, r.propertyName, r.landlordName,
            new Date(r.dueDate).toLocaleDateString("en-KE"),
            r.daysOverdue, r.bucket, r.amount]
    );

    const csv = [headers, ...dataRows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${isAR ? "AR" : "AP"}_Aging_${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, tab, asOf]);

  // ── Print PDF ───────────────────────────────────────────────────────────────
  const handlePrintPDF = useCallback(() => {
    const isAR = tab === "ar";
    const title = isAR ? "Arrears Aged Analysis" : "Payment Aged Analysis";
    const bucketLabel = (r) => BUCKETS.find((b) => b.key === r.bucket)?.label || "";
    const dueDate = (r) => new Date(r.dueDate).toLocaleDateString("en-KE");
    const days = (r) => (r.daysOverdue <= 0 ? "—" : r.daysOverdue);
    const columns = isAR
      ? [
          { label: "Invoice #", bold: true, value: (r) => r.invoiceNumber },
          { label: termTenant, value: (r) => r.tenantName },
          { label: `${termProperty} / ${termUnit}`, value: (r) => `${r.propertyName} / ${r.unitName}` },
          { label: "Due date", value: dueDate },
          { label: "Days over", align: "right", value: days },
          { label: "Bucket", value: bucketLabel },
          { label: "Outstanding (KES)", align: "right", bold: true, value: (r) => fmt(r.outstanding) },
        ]
      : [
          { label: "Reference", bold: true, value: (r) => r.reference },
          { label: "Narration", value: (r) => r.narration },
          { label: `${termProperty} / ${termLandlord}`, value: (r) => `${r.propertyName} / ${r.landlordName}` },
          { label: "Due date", value: dueDate },
          { label: "Days over", align: "right", value: days },
          { label: "Bucket", value: bucketLabel },
          { label: "Amount (KES)", align: "right", bold: true, value: (r) => fmt(r.amount) },
        ];
    const printed = printTabularList({
      title,
      subtitle: `As of ${new Date(asOf).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" })}`,
      company: currentCompany,
      summaryItems: [["Total outstanding", fmt(totals.total || 0)], ...BUCKETS.map((b) => [b.label, fmt(totals[b.key] || 0)])],
      columns,
      rows,
      totalsRow: ["TOTAL", "", "", "", "", "", fmt(totals.total || 0)],
      signatures: [{ label: "Prepared by" }, { label: "Reviewed by" }],
    });
    if (!printed) toast.error("Pop-ups blocked");
  }, [rows, totals, tab, asOf, currentCompany, termTenant, termProperty, termUnit, termLandlord]);

  // ── KPI strip ───────────────────────────────────────────────────────────────
  const kpiCells = useMemo(() => {
    const bucketTotals = BUCKETS.map((b) => ({ label: b.label, value: totals[b.key] || 0 }));
    return [
      { label: "Total Outstanding", value: fmt(totals.total || 0), sub: "all buckets", bold: true },
      ...bucketTotals.map((b) => ({ label: b.label, value: fmt(b.value), sub: "KES" })),
    ];
  }, [totals]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-[calc(100dvh-152px)] flex-col overflow-hidden">

        {/* ── Sticky toolbar ─────────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 bg-gray-50/95 px-4 py-2 shadow-sm backdrop-blur-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">As Of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
          />

          <button
            onClick={fetchData}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <FaSyncAlt size={10} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Refresh"}
          </button>

          <div className="flex-1" />

          <button
            onClick={handleExportCSV}
            className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: "#FF8C00" }}
          >
            <FaFileDownload size={10} />
            Export CSV
          </button>
          <button
            onClick={handlePrintPDF}
            className="flex h-7 items-center gap-1.5 rounded px-3 text-xs font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: GRN }}
          >
            <FaFilePdf size={10} />
            Print PDF
          </button>
        </div>

        {/* ── Business badge ─────────────────────────────────────────────────── */}
        {companyName && (
          <div className="shrink-0 px-4 py-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0B3B2E]/10 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0B3B2E]">
              {companyName}
            </span>
            <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              As of {new Date(asOf).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          </div>
        )}

        {/* ── Tabs ───────────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-slate-200 px-4">
          <div className="flex gap-1">
            {[
              { key: "ar", label: "Arrears Aged Analysis",  count: arData?.rows?.length },
              { key: "ap", label: "Payment Aged Analysis", count: apData?.rows?.length },
            ].map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-bold transition-colors ${
                  tab === key
                    ? "border-[#0B3B2E] text-[#0B3B2E]"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {label}
                {count != null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${tab === key ? "bg-[#0B3B2E] text-white" : "bg-slate-100 text-slate-500"}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
        <div className="grid shrink-0 grid-cols-6 divide-x divide-slate-200 border-b border-slate-200 bg-white">
          {kpiCells.map(({ label, value, sub, bold }) => (
            <div key={label} className="px-3 py-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
              <p className={`mt-0.5 font-mono text-sm ${bold ? "font-black text-slate-800" : "font-semibold text-slate-700"}`}>
                {value}
              </p>
              {sub && <p className="text-[9px] text-slate-400">{sub}</p>}
            </div>
          ))}
        </div>

        {/* ── Scrollable table ───────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
          <AgingTable rows={rows} totals={totals} type={tab} loading={loading && !rows.length} />
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ARAPAgingReport;
