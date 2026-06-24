import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaFileDownload, FaFilePdf, FaSyncAlt,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
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

const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── Aging Table ─────────────────────────────────────────────────────────────
const AgingTable = ({ rows, totals, type }) => {
  const isAR = type === "ar";

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <p className="text-sm font-medium">No outstanding {isAR ? "tenant arrears" : "pending payments"}</p>
      </div>
    );
  }

  return (
    <div className="min-w-full overflow-x-auto">
      <table className="min-w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-[#0B3B2E] text-white">
            {isAR ? (
              <>
                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Invoice #</th>
                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>
                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property / Unit</th>
              </>
            ) : (
              <>
                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Narration</th>
                <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property / Landlord</th>
              </>
            )}
            <th className="px-3 py-1 text-right font-bold border-r border-white/10">Due Date</th>
            <th className="px-3 py-1 text-right font-bold border-r border-white/10">Days Over</th>
            <th className="px-3 py-1 text-right font-bold border-r border-white/10">Bucket</th>
            <th className="px-3 py-1 text-right font-bold">Amount (KES)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
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
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800">
            <td colSpan={isAR ? 3 : 3} className="px-3 py-2 text-xs font-black uppercase text-slate-600">Totals</td>
            <td colSpan={3} />
            <td className="px-3 py-2 text-right font-mono text-sm">{fmt(totals?.total)}</td>
          </tr>
          {/* Bucket breakdown row */}
          <tr className="bg-slate-50/70 text-[10px] text-slate-500">
            <td colSpan={4} />
            {BUCKETS.map((b) => (
              <td key={b.key} className="px-2 py-1 text-right">
                <span className="block font-semibold text-slate-400">{b.label}</span>
                <span className={`font-bold ${(totals?.[b.key] || 0) > 0 ? "text-slate-700" : "text-slate-300"}`}>
                  {fmt(totals?.[b.key] || 0)}
                </span>
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const ARAPAgingReport = () => {
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const companyName = String(currentCompany?.companyName || currentCompany?.name || "").trim();

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
      ? ["Invoice #", "Tenant", "Property", "Unit", "Invoice Date", "Due Date", "Days Overdue", "Bucket", "Amount", "Applied", "Outstanding"]
      : ["Reference", "Narration", "Category", "Status", "Property", "Landlord", "Due Date", "Days Overdue", "Bucket", "Amount"];

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
    const headerRow = isAR
      ? `<th>Invoice #</th><th>Tenant</th><th>Property / Unit</th><th>Due Date</th><th>Days Over</th><th>Bucket</th><th class="right">Outstanding (KES)</th>`
      : `<th>Reference</th><th>Narration</th><th>Property / Landlord</th><th>Due Date</th><th>Days Over</th><th>Bucket</th><th class="right">Amount (KES)</th>`;

    const bodyRows = rows.map((r) => {
      const cells = isAR
        ? [r.invoiceNumber, r.tenantName, `${escapeHtml(r.propertyName)} / ${escapeHtml(r.unitName)}`,
            new Date(r.dueDate).toLocaleDateString("en-KE"), r.daysOverdue <= 0 ? "—" : r.daysOverdue,
            BUCKETS.find((b) => b.key === r.bucket)?.label, `<span class="right">${fmt(r.outstanding)}</span>`]
        : [r.reference, escapeHtml(r.narration), `${escapeHtml(r.propertyName)} / ${escapeHtml(r.landlordName)}`,
            new Date(r.dueDate).toLocaleDateString("en-KE"), r.daysOverdue <= 0 ? "—" : r.daysOverdue,
            BUCKETS.find((b) => b.key === r.bucket)?.label, `<span class="right">${fmt(r.amount)}</span>`];
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
    }).join("");

    const bucketBreakdown = BUCKETS.map((b) =>
      `<tr><td>${b.label}</td><td class="right">${fmt(totals[b.key] || 0)}</td></tr>`
    ).join("");

    const html = `<!DOCTYPE html><html><head><title>${title}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:10px;margin:20px}
  h2{font-size:14px;color:#0B3B2E;margin-bottom:4px}
  p.sub{font-size:9px;color:#6b7280;margin:0 0 12px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#f1f5f9;padding:5px 6px;text-align:left;font-size:9px;border-bottom:2px solid #cbd5e1;text-transform:uppercase}
  td{padding:4px 6px;border-bottom:1px solid #e2e8f0;vertical-align:middle}
  .right{text-align:right}
  tfoot td{font-weight:bold;border-top:2px solid #94a3b8;background:#f8fafc}
  h3{font-size:11px;color:#374151;margin:12px 0 4px}
  .badge{display:inline-block;padding:1px 6px;border-radius:999px;font-size:8px}
</style></head>
<body>
  <h2>${escapeHtml(companyName)} — ${title}</h2>
  <p class="sub">As of ${new Date(asOf).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" })}</p>
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr><td colspan="6" style="text-align:right;font-size:9px">TOTAL</td><td class="right">${fmt(totals.total)}</td></tr></tfoot>
  </table>
  <h3>Aging Breakdown</h3>
  <table style="width:200px">
    <thead><tr><th>Bucket</th><th class="right">Amount (KES)</th></tr></thead>
    <tbody>${bucketBreakdown}</tbody>
    <tfoot><tr><td>Total</td><td class="right">${fmt(totals.total)}</td></tr></tfoot>
  </table>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) return toast.error("Pop-ups blocked");
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 400);
  }, [rows, totals, tab, asOf, companyName]);

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
        <div className="flex-1 overflow-auto">
          {loading && !rows.length ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">Loading…</div>
          ) : (
            <AgingTable rows={rows} totals={totals} type={tab} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ARAPAgingReport;
