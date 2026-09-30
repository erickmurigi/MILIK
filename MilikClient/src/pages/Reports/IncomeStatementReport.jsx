import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useEntityCache } from "../../hooks/useEntityCache";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { FaChevronDown, FaChevronRight, FaFileDownload, FaFilePdf, FaSyncAlt } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { printTabularList } from "../../utils/printList";
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

const toLocalDateString = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstDayOfMonth = () => { const d = new Date(); return toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1)); };
const todayString = () => toLocalDateString(new Date());

// ─── Section row with proportion bar ─────────────────────────────────────────
const AccountRow = React.memo(({ row, sectionTotal, accentColor }) => {
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
});

// ─── Collapsible section ──────────────────────────────────────────────────────
const Section = React.memo(({ label, rows = [], total, categoryTotal, accentColor }) => {
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
});

// ─── Waterfall row ────────────────────────────────────────────────────────────
const WaterfallRow = React.memo(({ label, value, color, isTotal, barPct }) => (
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
));

// ─── Main ─────────────────────────────────────────────────────────────────────
const IncomeStatementReport = () => {
  const dispatch       = useDispatch();
  const currentUser    = useSelector((s) => s.auth?.currentUser);
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const properties     = useSelector(selectAllProperties);
  const canExport      = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const { propertiesLoaded } = useEntityCache(currentCompany?._id);

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
  const [filters, setFilters] = useTabState("/accounts/income-statement:filters", () => ({ startDate: firstDayOfMonth(), endDate: todayString(), propertyId: "" }));

  // Stable option array — avoids busting AppSelect's internal useMemo on every render
  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: `${p.propertyCode} – ${p.propertyName}` })), [properties]);

  useEffect(() => {
    if (businessId && !propertiesLoaded) dispatch(getProperties({ business: businessId }));
  }, [businessId]);  // eslint-disable-line react-hooks/exhaustive-deps

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
    const summary = report.summary || {};
    const np = Number(summary.netProfit || 0);
    const expRatio = Number(summary.totalIncome || 0) > 0
      ? ((Number(summary.totalExpenses || 0) / Number(summary.totalIncome || 0)) * 100).toFixed(1)
      : "0.0";
    // one statement: an Income block and an Expenses block, each with a heading per account group and its subtotal
    const block = (heading, sections, total) => [
      { __group: heading },
      ...(sections.length
        ? sections.flatMap((sec) => [
            { __group: sec.label, meta: `${pctStr(sec.total, total)} of ${heading.toLowerCase()}` },
            ...sec.rows.map((r) => ({ ...r, __share: pctStr(r.amount, sec.total) })),
            { __subtotal: ["", `Subtotal – ${sec.label}`, pctStr(sec.total, total), fmt(sec.total)] },
          ])
        : [{ __subtotal: ["", "No accounts found for this period.", "", ""] }]),
      { __subtotal: ["", `Total ${heading}`, "", fmt(total)] },
    ];
    const printed = printTabularList({
      title: "Income Statement",
      subtitle: `${filters.startDate} to ${filters.endDate}${selectedProperty ? ` · ${selectedProperty.propertyCode} – ${selectedProperty.propertyName || selectedProperty.name || ""}` : ""}`,
      company: currentCompany,
      orientation: "portrait",
      summaryItems: [
        ["Total income", `KES ${fmt(summary.totalIncome)}`],
        ["Total expenses", `KES ${fmt(summary.totalExpenses)}`],
        [summary.resultLabel || "Net profit", `KES ${fmt(summary.netProfit)}`],
        ["Expense ratio", `${expRatio}%`],
      ],
      columns: [
        { label: "Code", value: (r) => r.code },
        { label: "Account", value: (r) => r.name },
        { label: "% of group", align: "right", tone: () => "muted", value: (r) => r.__share },
        { label: "Amount (KES)", align: "right", value: (r) => fmt(r.amount) },
      ],
      rows: [
        ...block("Income", report.income?.sections || [], summary.totalIncome || 0),
        ...block("Expenses", report.expenses?.sections || [], summary.totalExpenses || 0),
      ],
      totalsRow: ["", summary.resultLabel || "Net profit", np >= 0 ? "Profitable" : "Loss", fmt(summary.netProfit)],
      signatures: [{ label: "Prepared by" }, { label: "Reviewed by" }],
    });
    if (!printed) toast.error("Popup blocked. Allow popups to print.");
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
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto">
            <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
              Income Statement
            </span>
            <div className="mx-1 h-4 w-px shrink-0 bg-slate-200" />
            <input
              type="date" value={filters.startDate}
              onChange={(e) => setFilters((p) => ({ ...p, startDate: e.target.value }))}
              className="h-7 shrink-0 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            />
            <span className="shrink-0 text-[10px] text-slate-400">to</span>
            <input
              type="date" value={filters.endDate}
              onChange={(e) => setFilters((p) => ({ ...p, endDate: e.target.value }))}
              className="h-7 shrink-0 border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            />
            {properties.length > 0 && (
              <AppSelect
                value={filters.propertyId}
                onChange={(v) => setFilters((p) => ({ ...p, propertyId: v ?? '' }))}
                options={propertyOptions}
                placeholder="All Properties"
                searchable
                clearable
                size="sm"
                className="shrink-0 w-36"
              />
            )}
            <span className="shrink-0 border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-500">{businessName}</span>
            {selectedProperty ? (
              <span className="shrink-0 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                {selectedProperty.propertyCode} – {selectedProperty.propertyName}
              </span>
            ) : (
              <span className="shrink-0 border border-slate-100 bg-slate-50 px-2 py-0.5 text-[9px] text-slate-400">
                {report.reportBasis || "All income & expenses"}
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
