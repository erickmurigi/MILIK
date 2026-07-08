import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { FaChevronDown, FaChevronRight, FaFileDownload, FaFilePdf, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getIncomeStatementReport } from "../../redux/apiCalls";
import { getProperties } from "../../redux/propertyRedux";
import { selectAllProperties } from "../../redux/selectors";

const GRN    = "#0B3B2E";
const RED    = "#DC2626";
const INC_C  = "#166534";   // income accent
const EXP_C  = "#991B1B";   // expense accent

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pctStr = (part, whole) =>
  whole > 0 ? `${Math.min(((part / whole) * 100), 100).toFixed(1)}%` : "—";

const pctNum = (part, whole) =>
  whole > 0 ? Math.min((part / whole) * 100, 100) : 0;

const firstDayOfMonth = () =>
  new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
const todayString = () => new Date().toISOString().split("T")[0];

const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

// ─── Section row with proportion bar ─────────────────────────────────────────
const AccountRow = ({ row, sectionTotal, accentColor }) => {
  const share = pctNum(row.amount, sectionTotal);
  const shareStr = pctStr(row.amount, sectionTotal);

  return (
    <div className="group border-b border-slate-50 last:border-0 hover:bg-slate-50/80">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="w-10 shrink-0 font-mono text-[9px] font-semibold text-slate-400">{row.code}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700" title={row.name}>{row.name}</span>
        {/* Proportion bar */}
        <div className="hidden w-20 shrink-0 sm:block">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${share}%`, backgroundColor: accentColor, opacity: 0.55 }}
            />
          </div>
        </div>
        <span className="w-10 shrink-0 text-right text-[9px] font-semibold tabular-nums text-slate-400">{shareStr}</span>
        <span className="w-24 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-slate-800">
          {fmt(row.amount)}
        </span>
      </div>
    </div>
  );
};

// ─── Collapsible section ──────────────────────────────────────────────────────
const Section = ({ label, rows = [], total, categoryTotal, accentColor }) => {
  const [open, setOpen] = useState(true);
  const share    = pctNum(total, categoryTotal);
  const shareStr = pctStr(total, categoryTotal);

  return (
    <div className="mb-1.5 overflow-hidden border border-slate-200">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-l-[3px] bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
        style={{ borderLeftColor: accentColor }}
      >
        <span className="text-slate-400">
          {open ? <FaChevronDown size={7} /> : <FaChevronRight size={7} />}
        </span>
        <span className="flex-1 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600">{label}</span>
        <span className="mr-3 text-[9px] font-semibold text-slate-400">{rows.length} acct{rows.length !== 1 ? "s" : ""}</span>
        <span className="mr-3 w-10 text-right text-[9px] font-bold tabular-nums" style={{ color: accentColor, opacity: 0.7 }}>{shareStr}</span>
        <span className="w-24 text-right font-mono text-[11px] font-black tabular-nums" style={{ color: accentColor }}>
          KES {fmt(total)}
        </span>
      </button>

      {/* Section proportion bar */}
      <div className="h-0.5 bg-slate-100">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${share}%`, backgroundColor: accentColor, opacity: 0.3 }}
        />
      </div>

      {/* Rows */}
      {open && (
        <div className="bg-white">
          {/* Column headers */}
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-1">
            <span className="w-10 shrink-0 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Code</span>
            <span className="flex-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Account</span>
            <span className="hidden w-20 shrink-0 sm:block text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Share</span>
            <span className="w-10 shrink-0 text-right text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">%</span>
            <span className="w-24 shrink-0 text-right text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Amount</span>
          </div>
          {rows.map((row) => (
            <AccountRow
              key={row._id || `${row.code}-${row.name}`}
              row={row}
              sectionTotal={total}
              accentColor={accentColor}
            />
          ))}
          {/* Section subtotal */}
          <div
            className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-1.5"
          >
            <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: accentColor, opacity: 0.7 }}>
              Subtotal · {label}
            </span>
            <span className="font-mono text-[11px] font-black tabular-nums" style={{ color: accentColor }}>
              KES {fmt(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Waterfall row ────────────────────────────────────────────────────────────
const WaterfallRow = ({ label, value, color, isTotal, barPct }) => (
  <div className={`flex items-center gap-3 py-2 ${isTotal ? "border-t-2 border-slate-200 mt-1 pt-3" : "border-t border-slate-100"}`}>
    <div className="w-32 shrink-0 text-[10px] font-bold text-slate-600">{label}</div>
    <div className="flex-1">
      <div className="h-2 overflow-hidden bg-slate-100">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${barPct}%`, backgroundColor: color, opacity: isTotal ? 1 : 0.65 }}
        />
      </div>
    </div>
    <div
      className={`w-32 shrink-0 text-right font-mono tabular-nums ${isTotal ? "text-base font-black" : "text-[12px] font-bold"}`}
      style={{ color }}
    >
      KES {fmt(value)}
    </div>
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────────
const IncomeStatementReport = () => {
  const dispatch       = useDispatch();
  const currentUser    = useSelector((s) => s.auth?.currentUser);
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const properties     = useSelector(selectAllProperties);
  const canExport      = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");

  const businessId = useMemo(() => {
    const activeId   = localStorage.getItem("milik_active_company_id");
    const storedUser = (() => { try { return JSON.parse(localStorage.getItem("milik_user") || "null"); } catch { return null; } })();
    return (
      currentCompany?._id || currentUser?.company?._id || currentUser?.company ||
      currentUser?.businessId || activeId || storedUser?.company?._id ||
      storedUser?.company || storedUser?.businessId || ""
    );
  }, [currentCompany?._id, currentUser?.company, currentUser?.businessId]);

  const businessName = currentCompany?.companyName || currentUser?.company?.companyName || "Active company";

  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState({
    income:   { sections: [], total: 0, count: 0 },
    expenses: { sections: [], total: 0, count: 0 },
    summary:  { totalIncome: 0, totalExpenses: 0, netProfit: 0, resultLabel: "Net Profit" },
    exclusions:  [],
    reportBasis: "",
  });
  const [filters, setFilters] = useState({
    startDate: firstDayOfMonth(),
    endDate:   todayString(),
    propertyId: "",
  });

  useEffect(() => {
    if (businessId) dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const selectedProperty = useMemo(
    () => properties.find((p) => p._id === filters.propertyId) || null,
    [properties, filters.propertyId]
  );

  const offGLProperties = useMemo(
    () => properties.filter((p) => {
      const v = String(p.accountLedgerType || "").toLowerCase().trim();
      return (v.startsWith("off") || v === "property-gl") && String(p.status || "").toLowerCase() !== "archived";
    }),
    [properties]
  );

  const loadReport = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const params = { business: businessId, startDate: filters.startDate, endDate: filters.endDate };
      if (filters.propertyId) params.propertyId = filters.propertyId;
      setReport(await getIncomeStatementReport(params));
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Failed to load income statement");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.startDate, filters.endDate, filters.propertyId]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!canExport) return toast.warning("You do not have permission to export reports");
    const lines = [
      "INCOME STATEMENT",
      `Period,${filters.startDate} to ${filters.endDate}`,
      ...(selectedProperty ? [`Property,${selectedProperty.propertyCode} – ${selectedProperty.propertyName}`] : []),
      "", "INCOME",
    ];
    report.income.sections.forEach((s) => {
      lines.push(s.label);
      s.rows.forEach((r) => lines.push(`${r.code},"${String(r.name).replaceAll('"', '""')}",${Number(r.amount).toFixed(2)},${pctStr(r.amount, s.total)}`));
      lines.push(`,"Subtotal – ${s.label}",${Number(s.total).toFixed(2)}`);
    });
    lines.push(`,"Total Income",${Number(report.summary?.totalIncome || 0).toFixed(2)}`, "", "EXPENSES");
    report.expenses.sections.forEach((s) => {
      lines.push(s.label);
      s.rows.forEach((r) => lines.push(`${r.code},"${String(r.name).replaceAll('"', '""')}",${Number(r.amount).toFixed(2)},${pctStr(r.amount, s.total)}`));
      lines.push(`,"Subtotal – ${s.label}",${Number(s.total).toFixed(2)}`);
    });
    lines.push(
      `,"Total Expenses",${Number(report.summary?.totalExpenses || 0).toFixed(2)}`,
      `,"${report.summary?.resultLabel || "Net Profit"}",${Number(report.summary?.netProfit || 0).toFixed(2)}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url });
    a.setAttribute("download", `income_statement_${filters.startDate}_to_${filters.endDate}.csv`);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported successfully");
  };

  // ── Print PDF ─────────────────────────────────────────────────────────────
  const handlePrintPDF = () => {
    if (!canExport) return toast.warning("You do not have permission to print reports");
    if (loading) return toast.info("Please wait for the report to finish loading.");
    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) return toast.error("Popup blocked. Allow popups to print.");

    const sectionHtml = (title, sections, total, color) => {
      const content = sections.length
        ? sections.map((s) => `
            <div class="s-block">
              <div class="s-head"><span>${escapeHtml(s.label)}</span><span>${pctStr(s.total, total)} · KES ${escapeHtml(fmt(s.total))}</span></div>
              ${s.rows.map((r) => `
                <div class="s-row">
                  <span class="code">${escapeHtml(r.code)}</span>
                  <span class="rname">${escapeHtml(r.name)}</span>
                  <span class="rpct">${pctStr(r.amount, s.total)}</span>
                  <span class="amt">KES ${escapeHtml(fmt(r.amount))}</span>
                </div>`).join("")}
            </div>`).join("")
        : `<div class="empty">No accounts found for this period.</div>`;
      return `<div class="card"><div class="card-hdr">${escapeHtml(title)} <span style="float:right;opacity:.7">KES ${escapeHtml(fmt(total))}</span></div><div class="card-body">${content}</div></div>`;
    };

    const np       = Number(report.summary?.netProfit || 0);
    const nc       = np >= 0 ? "#166534" : RED;
    const expRatio = Number(report.summary?.totalIncome || 0) > 0
      ? ((Number(report.summary?.totalExpenses || 0) / Number(report.summary?.totalIncome || 0)) * 100).toFixed(1)
      : "0.0";

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Income Statement</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:Arial,sans-serif;color:#111;padding:20px;font-size:11px}
        h1{font-size:20px;font-weight:900;color:${GRN};margin-bottom:2px}
        .sub{font-size:10px;color:#6b7280;margin-bottom:12px}
        .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
        .kpi-box{border-left:3px solid;padding:8px 10px}
        .kpi-box .lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:3px}
        .kpi-box .val{font-size:16px;font-weight:900}
        .kpi-box .sub2{font-size:8px;color:#9ca3af;margin-top:2px}
        .two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
        .card{border:1px solid #e5e7eb;overflow:hidden}
        .card-hdr{background:${GRN};color:#fff;padding:8px 10px;font-size:11px;font-weight:800;letter-spacing:.06em}
        .card-body{padding:10px}
        .s-block{margin-bottom:10px}
        .s-head{display:flex;justify-content:space-between;border-bottom:1px solid #f3f4f6;padding-bottom:4px;margin-bottom:4px;font-size:10px;font-weight:800;color:#374151}
        .s-row{display:flex;align-items:baseline;gap:6px;font-size:9.5px;padding:2px 0;color:#4b5563;border-bottom:1px solid #f9fafb}
        .code{font-family:monospace;color:#9ca3af;min-width:32px;font-weight:700}
        .rname{flex:1}
        .rpct{min-width:32px;text-align:right;color:#9ca3af;font-size:8.5px}
        .amt{min-width:80px;text-align:right;font-family:monospace;font-weight:700}
        .empty{font-size:10px;color:#9ca3af;font-style:italic}
        .waterfall{border:1px solid #e5e7eb;padding:12px 14px}
        .wf-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #f3f4f6}
        .wf-row:last-child{border-top:2px solid #d1d5db;border-bottom:none;padding-top:8px;margin-top:4px}
        .wf-lbl{min-width:120px;font-size:10px;font-weight:700;color:#6b7280}
        .wf-bar-wrap{flex:1;height:6px;background:#f3f4f6;overflow:hidden}
        .wf-bar{height:100%;opacity:.6}
        .wf-val{min-width:100px;text-align:right;font-family:monospace;font-weight:800;font-size:11px}
        @media print{body{padding:8px}@page{size:A4 portrait;margin:8mm}}
      </style></head><body>
      <h1>Income Statement</h1>
      <p class="sub">${escapeHtml(businessName)} · ${escapeHtml(filters.startDate)} → ${escapeHtml(filters.endDate)}${selectedProperty ? ` · ${escapeHtml(selectedProperty.propertyCode)} – ${escapeHtml(selectedProperty.propertyName)}` : ""}</p>
      <div class="kpi">
        <div class="kpi-box" style="border-color:#166534">
          <div class="lbl">Total Income</div>
          <div class="val" style="color:#166534">KES ${escapeHtml(fmt(report.summary?.totalIncome))}</div>
          <div class="sub2">${escapeHtml(String(report.income.count))} account(s)</div>
        </div>
        <div class="kpi-box" style="border-color:${RED}">
          <div class="lbl">Total Expenses</div>
          <div class="val" style="color:${RED}">KES ${escapeHtml(fmt(report.summary?.totalExpenses))}</div>
          <div class="sub2">${escapeHtml(String(report.expenses.count))} account(s)</div>
        </div>
        <div class="kpi-box" style="border-color:${nc}">
          <div class="lbl">${escapeHtml(report.summary?.resultLabel || "Net Profit")}</div>
          <div class="val" style="color:${nc}">KES ${escapeHtml(fmt(report.summary?.netProfit))}</div>
          <div class="sub2" style="color:${nc}">${np >= 0 ? "Profitable" : "Loss"}</div>
        </div>
        <div class="kpi-box" style="border-color:#92400e">
          <div class="lbl">Expense Ratio</div>
          <div class="val" style="color:#92400e">${escapeHtml(expRatio)}%</div>
          <div class="sub2">of total income</div>
        </div>
      </div>
      <div class="two">
        ${sectionHtml("Income",   report.income?.sections  || [], report.summary?.totalIncome   || 0, "#166534")}
        ${sectionHtml("Expenses", report.expenses?.sections || [], report.summary?.totalExpenses || 0, RED)}
      </div>
      <div class="waterfall">
        <div class="wf-row"><div class="wf-lbl">Total Income</div><div class="wf-bar-wrap"><div class="wf-bar" style="width:100%;background:#166534"></div></div><div class="wf-val" style="color:#166534">KES ${escapeHtml(fmt(report.summary?.totalIncome))}</div></div>
        <div class="wf-row"><div class="wf-lbl">Total Expenses</div><div class="wf-bar-wrap"><div class="wf-bar" style="width:${expRatio}%;background:${RED}"></div></div><div class="wf-val" style="color:${RED}">KES ${escapeHtml(fmt(report.summary?.totalExpenses))}</div></div>
        <div class="wf-row"><div class="wf-lbl">${escapeHtml(report.summary?.resultLabel || "Net Profit")}</div><div class="wf-bar-wrap"><div class="wf-bar" style="width:${Math.max(0, 100 - Number(expRatio))}%;background:${nc}"></div></div><div class="wf-val" style="color:${nc}">KES ${escapeHtml(fmt(report.summary?.netProfit))}</div></div>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const netProfit     = Number(report.summary?.netProfit    || 0);
  const totalIncome   = Number(report.summary?.totalIncome  || 0);
  const totalExpenses = Number(report.summary?.totalExpenses || 0);
  const netColor      = netProfit >= 0 ? INC_C : RED;
  const expenseRatio  = totalIncome > 0 ? (totalExpenses / totalIncome * 100) : 0;
  const netMargin     = totalIncome > 0 ? (netProfit / totalIncome * 100) : 0;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
              Income Statement
            </span>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <input
              type="date" value={filters.startDate}
              onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
              className="h-7 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            />
            <span className="text-[10px] text-slate-400">to</span>
            <input
              type="date" value={filters.endDate}
              onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
              className="h-7 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            />
            {properties.length > 0 && (
              <select
                value={filters.propertyId}
                onChange={(e) => setFilters((p) => ({ ...p, propertyId: e.target.value }))}
                className="h-7 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
              >
                <option value="">All Properties</option>
                {properties.map((p) => (
                  <option key={p._id} value={p._id}>{p.propertyCode} – {p.propertyName}</option>
                ))}
              </select>
            )}
            <span className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500">{businessName}</span>
            {selectedProperty ? (
              <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                {selectedProperty.propertyCode} – {selectedProperty.propertyName}
              </span>
            ) : (
              <span className="border border-slate-100 bg-slate-50 px-2 py-0.5 text-[9px] text-slate-400">
                {report.reportBasis || "All income & expenses"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={loadReport} disabled={loading}
                className="flex h-7 items-center gap-1.5 bg-blue-600 px-3 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
                {loading ? "Loading…" : "Refresh"}
              </button>
              <button onClick={handleExportCSV} disabled={!canExport}
                className="flex h-7 items-center gap-1.5 border border-[#FF8C00] bg-white px-3 text-[11px] font-bold text-[#FF8C00] hover:bg-orange-50 disabled:opacity-50">
                <FaFileDownload size={9} /> CSV
              </button>
              <button onClick={handlePrintPDF} disabled={!canExport}
                className="flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
                <FaFilePdf size={9} /> Print
              </button>
            </div>
          </div>
        </div>

        {/* ── Off-GL notice ─────────────────────────────────────────────────── */}
        {offGLProperties.length > 0 && !filters.propertyId && (
          <div className="shrink-0 flex items-center gap-2 border-b border-purple-200 bg-purple-50 px-4 py-1.5 print:hidden">
            <span className="text-purple-500 text-xs">⚠</span>
            <span className="text-[11px] text-purple-700">
              <span className="font-bold">{offGLProperties.length} {offGLProperties.length === 1 ? "property uses" : "properties use"} Property GL</span>
              {" "}and are excluded from this company report:{" "}
              {offGLProperties.map((p) => `${p.propertyCode} – ${p.propertyName}`).join(", ")}
              {". View their accounts via Property Ledger on the properties list."}
            </span>
          </div>
        )}
        {selectedProperty && (() => { const v = String(selectedProperty.accountLedgerType || "").toLowerCase().trim(); return v.startsWith("off") || v === "property-gl"; })() && (
          <div className="shrink-0 flex items-center gap-2 border-b border-purple-200 bg-purple-50 px-4 py-1.5 print:hidden">
            <span className="text-purple-500 text-xs">⚠</span>
            <span className="text-[11px] text-purple-700">
              <span className="font-bold">{selectedProperty.propertyCode} – {selectedProperty.propertyName}</span>
              {" "}uses Property GL — its accounts are isolated from the company GL. Use the Property Ledger to view this property's financial reports.
            </span>
          </div>
        )}

        {/* ── KPI strip ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 overflow-hidden border-b border-slate-200 bg-white shadow-sm">
          {/* Total Income */}
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-emerald-50 px-5 py-3">
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-600/70">Total Income</div>
            <div className="text-lg font-black tabular-nums text-emerald-700">KES {fmt(totalIncome)}</div>
            <div className="mt-0.5 text-[10px] font-medium text-emerald-600/60">
              {report.income.count} account{report.income.count !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Total Expenses */}
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-red-50 px-5 py-3">
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-red-600/70">Total Expenses</div>
            <div className="text-lg font-black tabular-nums text-red-700">KES {fmt(totalExpenses)}</div>
            <div className="mt-0.5 text-[10px] font-medium text-red-600/60">
              {report.expenses.count} account{report.expenses.count !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Expense ratio */}
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-amber-50 px-5 py-3">
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700/70">Expense Ratio</div>
            <div className="text-lg font-black tabular-nums text-amber-700">{expenseRatio.toFixed(1)}%</div>
            <div className="mt-1 h-1.5 overflow-hidden bg-amber-200">
              <div className="h-full bg-amber-500 transition-all duration-700" style={{ width: `${Math.min(expenseRatio, 100)}%` }} />
            </div>
          </div>

          {/* Net Profit */}
          <div className={`flex flex-1 flex-col px-5 py-3 ${netProfit >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: netColor, opacity: 0.7 }}>
              {report.summary?.resultLabel || "Net Profit"}
            </div>
            <div className="text-lg font-black tabular-nums" style={{ color: netColor }}>KES {fmt(netProfit)}</div>
            <div className="mt-0.5 text-[10px] font-bold" style={{ color: netColor, opacity: 0.7 }}>
              {netMargin.toFixed(1)}% net margin
            </div>
          </div>
        </div>

        {/* ── Scrollable body ───────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-[11px] font-semibold text-slate-400">
              Loading income statement…
            </div>
          ) : (
            <>
              {/* ── Two-column layout ───────────────────────────────────────── */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">

                {/* Income column */}
                <div>
                  <div className="mb-1.5 flex items-center gap-2 px-3 py-2" style={{ background: GRN }}>
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white">Income</span>
                    <span className="ml-auto font-mono text-[11px] font-black tabular-nums text-white">
                      KES {fmt(totalIncome)}
                    </span>
                  </div>
                  {report.income.sections.length ? (
                    report.income.sections.map((s) => (
                      <Section
                        key={s.label}
                        label={s.label}
                        rows={s.rows}
                        total={s.total}
                        categoryTotal={totalIncome}
                        accentColor={INC_C}
                      />
                    ))
                  ) : (
                    <div className="border border-dashed border-slate-200 px-4 py-8 text-center text-[11px] text-slate-400">
                      No income accounts found for this period
                    </div>
                  )}
                </div>

                {/* Expenses column */}
                <div>
                  <div className="mb-1.5 flex items-center gap-2 px-3 py-2" style={{ background: GRN }}>
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white">Expenses</span>
                    <span className="ml-auto font-mono text-[11px] font-black tabular-nums text-white">
                      KES {fmt(totalExpenses)}
                    </span>
                  </div>
                  {report.expenses.sections.length ? (
                    report.expenses.sections.map((s) => (
                      <Section
                        key={s.label}
                        label={s.label}
                        rows={s.rows}
                        total={s.total}
                        categoryTotal={totalExpenses}
                        accentColor={EXP_C}
                      />
                    ))
                  ) : (
                    <div className="border border-dashed border-slate-200 px-4 py-8 text-center text-[11px] text-slate-400">
                      No expense accounts found for this period
                    </div>
                  )}
                </div>
              </div>

              {/* ── Waterfall summary ─────────────────────────────────────────── */}
              <div className="mt-3 border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">Profit Summary</span>
                  <span className="text-[9px] text-slate-400">· {filters.startDate} — {filters.endDate}</span>
                </div>
                <div className="px-5 py-3">
                  <WaterfallRow
                    label="Total Income"
                    value={totalIncome}
                    color={INC_C}
                    barPct={100}
                  />
                  <WaterfallRow
                    label="Total Expenses"
                    value={totalExpenses}
                    color={EXP_C}
                    barPct={expenseRatio}
                  />
                  <WaterfallRow
                    label={report.summary?.resultLabel || "Net Profit"}
                    value={netProfit}
                    color={netColor}
                    barPct={Math.max(0, 100 - expenseRatio)}
                    isTotal
                  />
                </div>
              </div>

              {/* Exclusions */}
              {(report.exclusions || []).length > 0 && (
                <div className="mt-2 border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                    Excluded from this report
                  </div>
                  <ul className="space-y-0.5 text-[10px] text-slate-500">
                    {report.exclusions.map((item) => (
                      <li key={item} className="flex items-start gap-1.5">
                        <span className="mt-0.5 text-slate-300">·</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default IncomeStatementReport;
