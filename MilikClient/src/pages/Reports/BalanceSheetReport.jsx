import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { FaChevronDown, FaChevronRight, FaFileDownload, FaFilePdf, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getBalanceSheetReport } from "../../redux/apiCalls";

const GRN = "#0B3B2E";
const RED = "#DC2626";

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtSigned = (v) => {
  const n = Number(v || 0);
  const s = fmt(Math.abs(n));
  return n < 0 ? `(${s})` : s;
};

const todayString = () => new Date().toISOString().split("T")[0];

const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

// ─── Section block ────────────────────────────────────────────────────────────
const SectionBlock = ({ section, categoryTotal, accentColor }) => {
  const [open, setOpen] = useState(true);
  const share = categoryTotal > 0
    ? Math.min(Math.abs(section.total / categoryTotal) * 100, 100)
    : 0;
  const sharePct = categoryTotal > 0
    ? `${(Math.abs(section.total / categoryTotal) * 100).toFixed(1)}%`
    : "—";

  return (
    <div className="mb-1.5 overflow-hidden border border-slate-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-l-[3px] bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
        style={{ borderLeftColor: accentColor }}
      >
        <span className="text-slate-400">
          {open ? <FaChevronDown size={7} /> : <FaChevronRight size={7} />}
        </span>
        <span className="flex-1 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600">{section.label}</span>
        <span className="mr-3 text-[9px] font-semibold" style={{ color: accentColor, opacity: 0.7 }}>{sharePct}</span>
        <span className="w-28 text-right font-mono text-[11px] font-black tabular-nums" style={{ color: accentColor }}>
          KES {fmtSigned(section.total)}
        </span>
      </button>

      {/* Proportion bar */}
      <div className="h-0.5 bg-slate-100">
        <div className="h-full transition-all duration-700" style={{ width: `${share}%`, backgroundColor: accentColor, opacity: 0.3 }} />
      </div>

      {open && (
        <div className="bg-white">
          {/* Column header */}
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/50 px-3 py-1">
            <span className="w-10 shrink-0 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Code</span>
            <span className="flex-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Account</span>
            <span className="w-28 shrink-0 text-right text-[8px] font-bold uppercase tracking-[0.12em] text-slate-300">Amount</span>
          </div>
          {section.rows.map((row) => (
            <div
              key={row._id || `${row.code}-${row.name}`}
              className="flex items-center gap-2 border-b border-slate-50 px-3 py-1.5 last:border-0 hover:bg-slate-50"
            >
              <span className="w-10 shrink-0 font-mono text-[9px] font-semibold text-slate-400">{row.code}</span>
              <span className="flex-1 min-w-0 truncate text-[11px] text-slate-700" title={row.name}>{row.name}</span>
              <span className="w-28 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-slate-800">
                KES {fmtSigned(row.amount)}
              </span>
            </div>
          ))}
          {/* Subtotal */}
          <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 border-t border-slate-100">
            <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: accentColor, opacity: 0.7 }}>
              Subtotal · {section.label}
            </span>
            <span className="font-mono text-[11px] font-black tabular-nums" style={{ color: accentColor }}>
              KES {fmtSigned(section.total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Column card ──────────────────────────────────────────────────────────────
const ColumnCard = ({ title, sections, total, totalColor, accentColor, categoryTotal }) => (
  <div className="flex flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between px-4 py-2.5" style={{ background: GRN }}>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-white">{title}</span>
      <span className="font-mono text-[11px] font-black tabular-nums text-white">KES {fmtSigned(total)}</span>
    </div>
    <div className="flex-1 p-2">
      {sections.length ? (
        sections.map((s) => (
          <SectionBlock
            key={s.label}
            section={s}
            categoryTotal={Math.abs(categoryTotal || total)}
            accentColor={accentColor}
          />
        ))
      ) : (
        <div className="border border-dashed border-slate-200 py-8 text-center text-[11px] text-slate-400">
          No accounts found
        </div>
      )}
    </div>
    {/* Total row */}
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5">
      <span className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: totalColor }}>
        Total {title}
      </span>
      <span className="font-mono text-[13px] font-black tabular-nums" style={{ color: totalColor }}>
        KES {fmtSigned(total)}
      </span>
    </div>
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────────
const BalanceSheetReport = () => {
  const currentUser    = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
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

  const offGLProperties = useMemo(
    () => properties.filter((p) => {
      const v = String(p.accountLedgerType || "").toLowerCase().trim();
      return (v.startsWith("off") || v === "property-gl") && String(p.status || "").toLowerCase() !== "archived";
    }),
    [properties]
  );

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ asOfDate: todayString(), includeZeroBalances: false });
  const [report, setReport]   = useState({
    assets:      { sections: [], total: 0, count: 0 },
    liabilities: { sections: [], total: 0, count: 0 },
    equity:      { sections: [], total: 0, count: 0 },
    summary: {
      totalAssets: 0, totalLiabilities: 0, totalEquity: 0,
      totalLiabilitiesAndEquity: 0, difference: 0, balanced: true,
    },
    reportBasis: "",
  });

  const loadReport = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      setReport(await getBalanceSheetReport({
        business: businessId,
        asOfDate: filters.asOfDate,
        includeZeroBalances: filters.includeZeroBalances,
      }));
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Failed to load balance sheet");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.asOfDate, filters.includeZeroBalances]);

  useEffect(() => { loadReport(); }, [loadReport]);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!canExport) return toast.warning("You do not have permission to export reports");
    const lines = ["BALANCE SHEET", `As At,${filters.asOfDate}`, "", "ASSETS"];
    const addSections = (secs = []) =>
      secs.forEach((s) => {
        lines.push(s.label);
        s.rows.forEach((r) =>
          lines.push(`${r.code},"${String(r.name || "").replaceAll('"', '""')}",${Number(r.amount || 0).toFixed(2)}`)
        );
        lines.push(`,"Subtotal ${s.label}",${Number(s.total || 0).toFixed(2)}`);
      });
    addSections(report.assets?.sections);
    lines.push(`,"Total Assets",${Number(report.summary?.totalAssets || 0).toFixed(2)}`, "", "LIABILITIES");
    addSections(report.liabilities?.sections);
    lines.push(`,"Total Liabilities",${Number(report.summary?.totalLiabilities || 0).toFixed(2)}`, "", "EQUITY");
    addSections(report.equity?.sections);
    lines.push(
      `,"Total Equity",${Number(report.summary?.totalEquity || 0).toFixed(2)}`,
      `,"Total Liabilities + Equity",${Number(report.summary?.totalLiabilitiesAndEquity || 0).toFixed(2)}`,
      `,"Difference",${Number(report.summary?.difference || 0).toFixed(2)}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url });
    a.setAttribute("download", `balance_sheet_${filters.asOfDate}.csv`);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported successfully");
  };

  // ── Print PDF ─────────────────────────────────────────────────────────────
  const handlePrintPDF = () => {
    if (!canExport) return toast.warning("You do not have permission to print reports");
    if (loading)   return toast.info("Please wait for the report to finish loading.");
    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) return toast.error("Popup blocked. Allow popups to print.");

    const buildCard = (title, sections = [], total = 0, totalColor = "#111") => {
      const content = sections.length
        ? sections.map((s) => `
            <div class="s-block">
              <div class="s-head"><span>${escapeHtml(s.label)}</span><span>KES ${escapeHtml(fmtSigned(s.total))}</span></div>
              ${s.rows.map((r) => `
                <div class="s-row">
                  <span><span class="code">${escapeHtml(r.code)}</span>${escapeHtml(r.name)}</span>
                  <span class="amt">KES ${escapeHtml(fmtSigned(r.amount))}</span>
                </div>`).join("")}
            </div>`).join("")
        : `<div class="empty">No accounts found.</div>`;
      return `<div class="card"><div class="card-hdr">${escapeHtml(title)}</div><div class="card-body">${content}
        <div class="total-row" style="color:${totalColor}"><span>Total ${escapeHtml(title)}</span><span>KES ${escapeHtml(fmtSigned(total))}</span></div>
      </div></div>`;
    };

    const bal = report.summary?.balanced;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Balance Sheet</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:Arial,sans-serif;color:#111;padding:20px;font-size:11px}
        h1{font-size:20px;font-weight:900;color:${GRN};margin-bottom:2px}
        .sub{font-size:10px;color:#6b7280;margin-bottom:12px}
        .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
        .kpi-box{border-left:3px solid;padding:8px 10px}
        .kpi-box .lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:3px}
        .kpi-box .val{font-size:15px;font-weight:900}
        .two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
        .stack{display:flex;flex-direction:column;gap:12px}
        .card{border:1px solid #e5e7eb;overflow:hidden}
        .card-hdr{background:${GRN};color:#fff;padding:8px 10px;font-size:11px;font-weight:800;letter-spacing:.06em}
        .card-body{padding:10px}
        .s-block{margin-bottom:10px}
        .s-head{display:flex;justify-content:space-between;border-bottom:1px solid #f3f4f6;padding-bottom:3px;margin-bottom:4px;font-size:10px;font-weight:800;color:#374151}
        .s-row{display:flex;justify-content:space-between;align-items:baseline;font-size:9.5px;padding:2px 0 2px 8px;color:#4b5563;border-bottom:1px solid #f9fafb}
        .code{font-family:monospace;color:#9ca3af;margin-right:6px;font-weight:700}
        .amt{font-family:monospace;font-weight:700;white-space:nowrap}
        .total-row{display:flex;justify-content:space-between;border-top:2px solid #e5e7eb;margin-top:8px;padding-top:7px;font-size:12px;font-weight:800}
        .empty{font-size:10px;color:#9ca3af;font-style:italic}
        .summary{border:1px solid #e5e7eb;overflow:hidden}
        .summary .hdr{background:#374151;color:#fff;padding:8px 10px;font-size:11px;font-weight:800}
        .summary .row{display:flex;justify-content:space-between;padding:5px 10px;font-size:11px;border-bottom:1px solid #f3f4f6}
        .summary .diff{font-weight:900;border-top:2px solid #d1d5db;border-bottom:none;padding-top:8px;font-size:12px}
        @media print{body{padding:8px}@page{size:A4 portrait;margin:8mm}}
      </style></head><body>
      <h1>Balance Sheet</h1>
      <p class="sub">${escapeHtml(businessName)} · As at ${escapeHtml(filters.asOfDate)} · ${escapeHtml(report.reportBasis || "Accrual basis")}</p>
      <div class="kpi">
        <div class="kpi-box" style="border-color:${GRN}"><div class="lbl">Total Assets</div><div class="val" style="color:${GRN}">KES ${escapeHtml(fmtSigned(report.summary?.totalAssets))}</div></div>
        <div class="kpi-box" style="border-color:${RED}"><div class="lbl">Total Liabilities</div><div class="val" style="color:${RED}">KES ${escapeHtml(fmtSigned(report.summary?.totalLiabilities))}</div></div>
        <div class="kpi-box" style="border-color:#15803d"><div class="lbl">Total Equity</div><div class="val" style="color:#15803d">KES ${escapeHtml(fmtSigned(report.summary?.totalEquity))}</div></div>
        <div class="kpi-box" style="border-color:${bal ? GRN : RED}"><div class="lbl">Status</div><div class="val" style="color:${bal ? GRN : RED}">${bal ? "Balanced" : "Out of Balance"}</div></div>
      </div>
      <div class="two">
        ${buildCard("Assets", report.assets?.sections || [], report.summary?.totalAssets || 0, GRN)}
        <div class="stack">
          ${buildCard("Liabilities", report.liabilities?.sections || [], report.summary?.totalLiabilities || 0, RED)}
          ${buildCard("Equity", report.equity?.sections || [], report.summary?.totalEquity || 0, "#15803d")}
        </div>
      </div>
      <div class="summary">
        <div class="hdr">Statement Summary</div>
        <div class="row"><span>Total Assets</span><span style="color:${GRN}">KES ${escapeHtml(fmtSigned(report.summary?.totalAssets))}</span></div>
        <div class="row"><span>Total Liabilities</span><span style="color:${RED}">KES ${escapeHtml(fmtSigned(report.summary?.totalLiabilities))}</span></div>
        <div class="row"><span>Total Equity</span><span style="color:#15803d">KES ${escapeHtml(fmtSigned(report.summary?.totalEquity))}</span></div>
        <div class="row"><span>Liabilities + Equity</span><span>KES ${escapeHtml(fmtSigned(report.summary?.totalLiabilitiesAndEquity))}</span></div>
        <div class="row diff" style="color:${bal ? GRN : RED}"><span>Difference</span><span>KES ${escapeHtml(fmtSigned(report.summary?.difference))}</span></div>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const { summary = {} } = report;
  const isBalanced = summary.balanced !== false;

  return (
    <DashboardLayout lockContentScroll>
      {/* overflow-y-auto lives on the body div — toolbar + KPI are always visible */}
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* ── Sticky toolbar ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
              Balance Sheet
            </span>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <input
              type="date"
              value={filters.asOfDate}
              onChange={(e) => setFilters((p) => ({ ...p, asOfDate: e.target.value }))}
              className="h-7 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            />
            <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={filters.includeZeroBalances}
                onChange={(e) => setFilters((p) => ({ ...p, includeZeroBalances: e.target.checked }))}
                className="h-3 w-3"
              />
              Zero balances
            </label>
            <span className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500">
              {businessName}
            </span>
            <span className="border border-slate-100 bg-slate-50 px-2 py-0.5 text-[9px] text-slate-400">
              {report.reportBasis || "Accrual basis · chart accounts + posted ledger balances"}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={loadReport} disabled={loading}
                className="flex h-7 items-center gap-1.5 bg-blue-600 px-3 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
                {loading ? "Loading…" : "Refresh"}
              </button>
              <button
                onClick={handleExportCSV} disabled={!canExport}
                className="flex h-7 items-center gap-1.5 border border-[#FF8C00] bg-white px-3 text-[11px] font-bold text-[#FF8C00] hover:bg-orange-50 disabled:opacity-50"
              >
                <FaFileDownload size={9} /> CSV
              </button>
              <button
                onClick={handlePrintPDF} disabled={!canExport}
                className="flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                <FaFilePdf size={9} /> Print
              </button>
            </div>
          </div>
        </div>

        {/* ── Property GL notice ────────────────────────────────────────────── */}
        {offGLProperties.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 border-b border-purple-200 bg-purple-50 px-4 py-1.5 print:hidden">
            <span className="text-purple-500 text-xs">⚠</span>
            <span className="text-[11px] text-purple-700">
              <span className="font-bold">{offGLProperties.length} {offGLProperties.length === 1 ? "property uses" : "properties use"} Property GL</span>
              {" "}and {offGLProperties.length === 1 ? "is" : "are"} excluded from this company report:{" "}
              {offGLProperties.map((p) => `${p.propertyCode} – ${p.propertyName}`).join(", ")}
              {". "}View their accounts via Property Ledger on the properties list.
            </span>
          </div>
        )}

        {/* ── KPI strip ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 overflow-hidden border-b border-slate-200 bg-white shadow-sm">
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-emerald-50 px-5 py-3">
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700/60">Total Assets</div>
            <div className="text-lg font-black tabular-nums text-emerald-700">KES {fmtSigned(summary.totalAssets)}</div>
            <div className="mt-0.5 text-[10px] text-emerald-600/60">{report.assets?.count || 0} account(s)</div>
          </div>
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-red-50 px-5 py-3">
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-red-700/60">Total Liabilities</div>
            <div className="text-lg font-black tabular-nums text-red-700">KES {fmtSigned(summary.totalLiabilities)}</div>
            <div className="mt-0.5 text-[10px] text-red-600/60">{report.liabilities?.count || 0} account(s)</div>
          </div>
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-green-50 px-5 py-3">
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-green-700/60">Total Equity</div>
            <div className="text-lg font-black tabular-nums text-green-700">KES {fmtSigned(summary.totalEquity)}</div>
            <div className="mt-0.5 text-[10px] text-green-600/60">{report.equity?.count || 0} account(s)</div>
          </div>
          <div className={`flex flex-1 flex-col px-5 py-3 ${isBalanced ? "bg-emerald-50" : "bg-red-50"}`}>
            <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: isBalanced ? "#166534" : RED, opacity: 0.6 }}>
              Status
            </div>
            <div className="text-lg font-black" style={{ color: isBalanced ? "#166534" : RED }}>
              {isBalanced ? "Balanced" : "Out of Balance"}
            </div>
            <div className="mt-0.5 text-[10px]" style={{ color: isBalanced ? "#166534" : RED, opacity: 0.6 }}>
              Diff: KES {fmtSigned(summary.difference)}
            </div>
          </div>
        </div>

        {/* scroll happens here — toolbar + KPI strip always visible above */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-[11px] font-semibold text-slate-400">
              Loading balance sheet…
            </div>
          ) : (
            <>
              {/* Two-column layout — stacks to single column below lg */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {/* Assets */}
                <ColumnCard
                  title="Assets"
                  sections={report.assets?.sections || []}
                  total={summary.totalAssets || 0}
                  totalColor={GRN}
                  accentColor="#166534"
                  categoryTotal={Math.abs(summary.totalAssets || 1)}
                />

                {/* Liabilities + Equity stacked */}
                <div className="space-y-3">
                  <ColumnCard
                    title="Liabilities"
                    sections={report.liabilities?.sections || []}
                    total={summary.totalLiabilities || 0}
                    totalColor={RED}
                    accentColor="#991B1B"
                    categoryTotal={Math.abs(summary.totalLiabilities || 1)}
                  />
                  <ColumnCard
                    title="Equity"
                    sections={report.equity?.sections || []}
                    total={summary.totalEquity || 0}
                    totalColor="#15803d"
                    accentColor="#15803d"
                    categoryTotal={Math.abs(summary.totalEquity || 1)}
                  />
                </div>
              </div>

              {/* Statement Summary strip */}
              <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="px-4 py-2.5" style={{ background: GRN }}>
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white">Statement Summary</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {[
                    { label: "Total Assets",         value: summary.totalAssets,             color: "#166534"  },
                    { label: "Total Liabilities",     value: summary.totalLiabilities,        color: RED        },
                    { label: "Total Equity",          value: summary.totalEquity,             color: "#15803d"  },
                    { label: "Liabilities + Equity",  value: summary.totalLiabilitiesAndEquity, color: "#111"   },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between px-5 py-2">
                      <span className="text-[11px] font-semibold text-slate-600">{label}</span>
                      <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color }}>
                        KES {fmtSigned(value)}
                      </span>
                    </div>
                  ))}
                  <div
                    className="flex items-center justify-between border-t-2 px-5 py-3"
                    style={{ borderTopColor: isBalanced ? "#bbf7d0" : "#fecaca" }}
                  >
                    <span className="text-[12px] font-black text-slate-800">Difference</span>
                    <span
                      className="font-mono text-[14px] font-black tabular-nums"
                      style={{ color: isBalanced ? "#166534" : RED }}
                    >
                      KES {fmtSigned(summary.difference)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default BalanceSheetReport;
