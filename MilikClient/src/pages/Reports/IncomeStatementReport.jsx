import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { FaChevronDown, FaChevronRight, FaFileDownload, FaFilePdf, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getIncomeStatementReport } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { selectAllProperties } from "../../redux/selectors";

const GRN = "#0B3B2E";
const GRN_BG = "bg-[#0B3B2E]";
const RED = "#DC2626";

const fmt = (value) =>
  Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const firstDayOfMonth = () =>
  new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

const todayString = () => new Date().toISOString().split("T")[0];

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// ─── Collapsible section ──────────────────────────────────────────────────────
const Section = ({ label, rows = [], total, accentColor }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-slate-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          {open ? <FaChevronDown size={9} className="text-slate-400" /> : <FaChevronRight size={9} className="text-slate-400" />}
          <span className="text-xs font-bold text-slate-700">{label}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
            {rows.length}
          </span>
        </div>
        <span className="text-xs font-bold" style={{ color: accentColor }}>
          KES {fmt(total)}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 bg-white">
          {rows.map((row) => (
            <div
              key={row._id || `${row.code}-${row.name}`}
              className="flex items-center justify-between px-4 py-2 text-xs hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 text-slate-700">
                <span className="w-14 shrink-0 font-mono text-[10px] font-semibold text-slate-400">
                  {row.code}
                </span>
                <span className="font-medium">{row.name}</span>
              </div>
              <span className="ml-4 shrink-0 font-mono font-semibold text-slate-800">
                {fmt(row.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const IncomeStatementReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((s) => s.auth?.currentUser);
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const properties = useSelector(selectAllProperties);
  const canExport = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");

  const businessId = useMemo(() => {
    const activeId = localStorage.getItem("milik_active_company_id");
    const storedUser = (() => {
      try { return JSON.parse(localStorage.getItem("milik_user") || "null"); } catch { return null; }
    })();
    return (
      currentCompany?._id ||
      currentUser?.company?._id ||
      currentUser?.company ||
      currentUser?.businessId ||
      activeId ||
      storedUser?.company?._id ||
      storedUser?.company ||
      storedUser?.businessId ||
      ""
    );
  }, [currentCompany?._id, currentUser?.company, currentUser?.businessId]);

  const businessName =
    currentCompany?.companyName || currentUser?.company?.companyName || "Active company";

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState({
    income: { sections: [], total: 0, count: 0 },
    expenses: { sections: [], total: 0, count: 0 },
    summary: { totalIncome: 0, totalExpenses: 0, netProfit: 0, resultLabel: "Net Profit" },
    exclusions: [],
    reportBasis: "",
  });
  const [filters, setFilters] = useState({ startDate: firstDayOfMonth(), endDate: todayString(), propertyId: "" });

  useEffect(() => {
    if (businessId) dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const selectedProperty = useMemo(
    () => properties.find((p) => p._id === filters.propertyId) || null,
    [properties, filters.propertyId]
  );

  const loadReport = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = { business: businessId, startDate: filters.startDate, endDate: filters.endDate };
      if (filters.propertyId) params.propertyId = filters.propertyId;
      const data = await getIncomeStatementReport(params);
      setReport(data);
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Failed to load income statement");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.startDate, filters.endDate, filters.propertyId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // ── Export CSV
  const handleExportCSV = () => {
    if (!canExport) return toast.warning("You do not have permission to export reports");
    const lines = [
      "INCOME STATEMENT",
      `Period,${filters.startDate} to ${filters.endDate}`,
      ...(selectedProperty ? [`Property,${selectedProperty.propertyCode} – ${selectedProperty.propertyName}`] : []),
      "",
      "INCOME",
    ];
    report.income.sections.forEach((s) => {
      lines.push(s.label);
      s.rows.forEach((r) => lines.push(`${r.code},"${String(r.name).replaceAll('"', '""')}",${Number(r.amount).toFixed(2)}`));
      lines.push(`,"Subtotal ${s.label}",${Number(s.total).toFixed(2)}`);
    });
    lines.push(`,"Total Income",${Number(report.summary?.totalIncome || 0).toFixed(2)}`);
    lines.push("", "EXPENSES");
    report.expenses.sections.forEach((s) => {
      lines.push(s.label);
      s.rows.forEach((r) => lines.push(`${r.code},"${String(r.name).replaceAll('"', '""')}",${Number(r.amount).toFixed(2)}`));
      lines.push(`,"Subtotal ${s.label}",${Number(s.total).toFixed(2)}`);
    });
    lines.push(`,"Total Expenses",${Number(report.summary?.totalExpenses || 0).toFixed(2)}`);
    lines.push(`,"${report.summary?.resultLabel || "Net Profit"}",${Number(report.summary?.netProfit || 0).toFixed(2)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", `income_statement_${filters.startDate}_to_${filters.endDate}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported successfully");
  };

  // ── Print PDF
  const handlePrintPDF = () => {
    if (!canExport) return toast.warning("You do not have permission to print reports");
    if (loading) return toast.info("Please wait for the report to finish loading.");
    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) return toast.error("Popup blocked. Allow popups to print.");

    const sectionHtml = (title, sections, total, color) => {
      const content = sections.length
        ? sections.map((s) => `
            <div class="s-block">
              <div class="s-head"><span>${escapeHtml(s.label)}</span><span>KES ${escapeHtml(fmt(s.total))}</span></div>
              ${s.rows.map((r) => `<div class="s-row"><span class="code">${escapeHtml(r.code)}</span>${escapeHtml(r.name)}<span class="amt">KES ${escapeHtml(fmt(r.amount))}</span></div>`).join("")}
            </div>`).join("")
        : `<div class="empty">No accounts found for this period.</div>`;
      return `<div class="card"><div class="card-hdr">${escapeHtml(title)}</div><div class="card-body">${content}<div class="total-row" style="color:${color}"><span>Total ${escapeHtml(title)}</span><span>KES ${escapeHtml(fmt(total))}</span></div></div></div>`;
    };

    const netProfit = Number(report.summary?.netProfit || 0);
    const netColor = netProfit >= 0 ? "#166534" : RED;

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
      <title>Income Statement</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111;padding:24px}
        h1{font-size:26px;font-weight:800;color:${GRN}}p.sub{font-size:12px;color:#4b5563;margin:4px 0 16px}
        .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
        .meta-box{border:1px solid #d1d5db;border-radius:6px;padding:10px 12px;background:#f9fafb}
        .meta-box .lbl{font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:3px}
        .meta-box .val{font-size:13px;font-weight:800;color:#111}
        .kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
        .kpi-box{border:1px solid #d1d5db;border-radius:6px;padding:12px 14px}
        .kpi-box .lbl{font-size:10px;font-weight:700;text-transform:uppercase;color:#6b7280;margin-bottom:5px}
        .kpi-box .val{font-size:20px;font-weight:900}
        .two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
        .card{border:1px solid #d1d5db;border-radius:6px;overflow:hidden}
        .card-hdr{background:${GRN};color:#fff;padding:10px 12px;font-size:14px;font-weight:800}
        .card-body{padding:12px}
        .s-block{margin-bottom:14px}
        .s-head{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding-bottom:5px;margin-bottom:6px;font-size:12px;font-weight:800}
        .s-row{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;padding:3px 0;color:#374151}
        .code{font-family:monospace;font-weight:700;color:#9ca3af;margin-right:8px;min-width:40px}
        .amt{font-family:monospace;font-weight:700;white-space:nowrap}
        .total-row{display:flex;justify-content:space-between;border-top:2px solid #d1d5db;margin-top:12px;padding-top:10px;font-size:14px;font-weight:800}
        .empty{font-size:12px;color:#6b7280;font-style:italic}
        .net-box{border:2px solid ${netColor};border-radius:6px;padding:14px 16px;background:${netProfit >= 0 ? "#f0fdf4" : "#fef2f2"};display:flex;justify-content:space-between;align-items:center}
        .net-label{font-size:16px;font-weight:800;color:${netColor}}
        .net-val{font-size:22px;font-weight:900;color:${netColor};font-family:monospace}
        @media print{body{padding:10px}@page{size:A4 portrait;margin:12mm}}
      </style></head><body>
      <h1>Income Statement</h1>
      <p class="sub">${selectedProperty ? `${escapeHtml(selectedProperty.propertyCode)} – ${escapeHtml(selectedProperty.propertyName)} · ` : `${escapeHtml(report.reportBasis || "All operating income and expenses")} · `}${escapeHtml(filters.startDate)} to ${escapeHtml(filters.endDate)}</p>
      <div class="meta">
        <div class="meta-box"><div class="lbl">Business</div><div class="val">${escapeHtml(businessName)}</div></div>
        <div class="meta-box"><div class="lbl">Period</div><div class="val">${escapeHtml(filters.startDate)} → ${escapeHtml(filters.endDate)}</div></div>
        <div class="meta-box"><div class="lbl">${selectedProperty ? "Property" : "Basis"}</div><div class="val">${selectedProperty ? escapeHtml(`${selectedProperty.propertyCode} – ${selectedProperty.propertyName}`) : escapeHtml(report.reportBasis || "Manager income & expenses only")}</div></div>
      </div>
      <div class="kpi">
        <div class="kpi-box"><div class="lbl">Total Income</div><div class="val" style="color:#166534">KES ${escapeHtml(fmt(report.summary?.totalIncome))}</div></div>
        <div class="kpi-box"><div class="lbl">Total Expenses</div><div class="val" style="color:${RED}">KES ${escapeHtml(fmt(report.summary?.totalExpenses))}</div></div>
        <div class="kpi-box"><div class="lbl">${escapeHtml(report.summary?.resultLabel || "Net Profit")}</div><div class="val" style="color:${netColor}">KES ${escapeHtml(fmt(report.summary?.netProfit))}</div></div>
      </div>
      <div class="two">
        ${sectionHtml("Income", report.income?.sections || [], report.summary?.totalIncome || 0, "#166534")}
        ${sectionHtml("Expenses", report.expenses?.sections || [], report.summary?.totalExpenses || 0, RED)}
      </div>
      <div class="net-box">
        <div class="net-label">${escapeHtml(report.summary?.resultLabel || "Net Profit")}</div>
        <div class="net-val">KES ${escapeHtml(fmt(report.summary?.netProfit))}</div>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const netProfit = Number(report.summary?.netProfit || 0);
  const netColor = netProfit >= 0 ? "#166534" : RED;
  const totalIncome = Number(report.summary?.totalIncome || 0);
  const totalExpenses = Number(report.summary?.totalExpenses || 0);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="h-[calc(100dvh-152px)] max-h-[calc(100dvh-152px)] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">

          {/* ── Sticky toolbar ──────────────────────────────────────────────── */}
          <div className="sticky top-0 z-30 shrink-0 border-b border-gray-200 bg-gray-50/95 p-2 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-800">Income Statement</span>

              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
                <span className="text-[10px] font-medium text-slate-400">to</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
              </div>

              {properties.length > 0 && (
                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters((p) => ({ ...p, propertyId: e.target.value }))}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                >
                  <option value="">All Properties</option>
                  {properties.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.propertyCode} – {p.propertyName}
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={loadReport}
                disabled={loading}
                className="flex h-7 items-center gap-1.5 rounded bg-blue-600 px-3 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
                {loading ? "Loading…" : "Refresh"}
              </button>

              <div className="flex-1" />

              <button
                onClick={handleExportCSV}
                disabled={!canExport}
                title={!canExport ? "No export permission" : "Export CSV"}
                className="flex h-7 items-center gap-1.5 rounded bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00] disabled:opacity-50"
              >
                <FaFileDownload size={9} /> Export CSV
              </button>
              <button
                onClick={handlePrintPDF}
                disabled={!canExport}
                title={!canExport ? "No print permission" : "Print PDF"}
                className="flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                <FaFilePdf size={9} /> Print PDF
              </button>
            </div>

            {/* Business + scope badges */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {businessName}
              </span>
              {selectedProperty ? (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {selectedProperty.propertyCode} – {selectedProperty.propertyName}
                </span>
              ) : (
                <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  {report.reportBasis || "All operating income and expenses for this company"}
                </span>
              )}
            </div>
          </div>

          {/* ── KPI strip ───────────────────────────────────────────────────── */}
          <div className="shrink-0 grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-white">
            <div className="px-5 py-3">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                Total Income
              </div>
              <div className="text-lg font-black tabular-nums text-emerald-700">
                KES {fmt(totalIncome)}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {report.income.count} account{report.income.count !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                Total Expenses
              </div>
              <div className="text-lg font-black tabular-nums text-red-600">
                KES {fmt(totalExpenses)}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {report.expenses.count} account{report.expenses.count !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {report.summary?.resultLabel || "Net Profit"}
              </div>
              <div
                className="text-lg font-black tabular-nums"
                style={{ color: netColor }}
              >
                KES {fmt(netProfit)}
              </div>
              <div className="mt-0.5 text-[10px]" style={{ color: netColor }}>
                {netProfit >= 0 ? "Profitable period" : "Loss period"}
              </div>
            </div>
          </div>

          {/* ── Scrollable content ───────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-xs font-semibold text-slate-400">
                Loading income statement…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

                {/* Income */}
                <div>
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2.5 text-white">
                    <span className="text-xs font-bold tracking-wide">INCOME</span>
                    <span className="ml-auto text-xs font-black">KES {fmt(totalIncome)}</span>
                  </div>
                  {report.income.sections.length ? (
                    report.income.sections.map((s) => (
                      <Section
                        key={s.label}
                        label={s.label}
                        rows={s.rows}
                        total={s.total}
                        accentColor="#166534"
                      />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
                      No income accounts found for this period
                    </div>
                  )}
                </div>

                {/* Expenses */}
                <div>
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2.5 text-white">
                    <span className="text-xs font-bold tracking-wide">EXPENSES</span>
                    <span className="ml-auto text-xs font-black">KES {fmt(totalExpenses)}</span>
                  </div>
                  {report.expenses.sections.length ? (
                    report.expenses.sections.map((s) => (
                      <Section
                        key={s.label}
                        label={s.label}
                        rows={s.rows}
                        total={s.total}
                        accentColor={RED}
                      />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
                      No expense accounts found for this period
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* Net result bar */}
            {!loading && (
              <div
                className="mt-4 flex items-center justify-between rounded-xl border-2 px-6 py-4"
                style={{
                  borderColor: netColor,
                  background: netProfit >= 0 ? "#f0fdf4" : "#fef2f2",
                }}
              >
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: netColor }}>
                    {report.summary?.resultLabel || "Net Profit"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {filters.startDate} — {filters.endDate}
                  </div>
                </div>
                <div className="text-2xl font-black tabular-nums" style={{ color: netColor }}>
                  KES {fmt(netProfit)}
                </div>
              </div>
            )}

            {/* Exclusions note */}
            {!loading && (report.exclusions || []).length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                  Excluded from this report
                </div>
                <ul className="space-y-0.5 text-[10px] font-medium text-slate-500">
                  {report.exclusions.map((item) => (
                    <li key={item} className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-slate-300">•</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default IncomeStatementReport;
