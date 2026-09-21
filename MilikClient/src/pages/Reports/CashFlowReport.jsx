import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { printTabularList } from "../../utils/printList";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { FaChevronDown, FaChevronRight, FaFileDownload, FaFilePdf, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getCashFlowReport } from "../../redux/apiCalls";
import { selectAllProperties } from "../../redux/selectors";

const GRN = "#0B3B2E";
const RED = "#DC2626";

const fmt = (value) =>
  Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtSigned = (value) => {
  const n = Number(value || 0);
  return n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
};

// Local-timezone date helpers — avoids UTC-shift on UTC+3 (Kenya)
const localDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const firstDayOfMonth = () => {
  const d = new Date();
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
};
const todayString = () => localDateStr(new Date());

// ─── Collapsible cash-flow section ───────────────────────────────────────────
const CashSection = ({ title, items = [], totalInflows, totalOutflows, net, accentColor }) => {
  const [open, setOpen] = useState(true);
  const netColor = net >= 0 ? "#166534" : RED;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          {open
            ? <FaChevronDown size={9} className="text-slate-400" />
            : <FaChevronRight size={9} className="text-slate-400" />}
          <span className="text-xs font-bold text-slate-700">{title}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
            {items.length} line{items.length !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-xs font-black" style={{ color: netColor }}>
          Net: KES {fmtSigned(net)}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-white">
          {/* Column header */}
          {items.length > 0 && (
            <div className="flex items-center border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">
              <span className="flex-1">Item</span>
              <span className="w-32 text-right text-emerald-700">Cash In</span>
              <span className="w-32 text-right text-rose-700">Cash Out</span>
              <span className="w-32 text-right text-slate-700">Net</span>
            </div>
          )}

          {items.length > 0 ? items.map((item) => (
            <div
              key={item.sourceType}
              className="flex items-center justify-between px-4 py-2 text-xs hover:bg-slate-50"
            >
              <span className="flex-1 font-medium text-slate-700">{item.label}</span>
              <span className="w-32 text-right font-mono font-semibold text-emerald-700">
                {item.inflow > 0 ? `KES ${fmt(item.inflow)}` : "—"}
              </span>
              <span className="w-32 text-right font-mono font-semibold text-rose-700">
                {item.outflow > 0 ? `KES ${fmt(item.outflow)}` : "—"}
              </span>
              <span
                className="w-32 text-right font-mono font-black"
                style={{ color: item.net >= 0 ? "#1e293b" : RED }}
              >
                KES {fmtSigned(item.net)}
              </span>
            </div>
          )) : (
            <div className="px-4 py-6 text-center text-xs italic text-slate-400">
              No cash movements in this category for the selected period.
            </div>
          )}

          {/* Section totals row */}
          {items.length > 0 && (
            <div className="flex items-center border-t-2 border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black">
              <span className="flex-1 uppercase tracking-wider text-slate-500">Total</span>
              <span className="w-32 text-right font-mono text-emerald-800">KES {fmt(totalInflows)}</span>
              <span className="w-32 text-right font-mono text-rose-800">KES {fmt(totalOutflows)}</span>
              <span className="w-32 text-right font-mono" style={{ color: netColor }}>KES {fmtSigned(net)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const CashFlowReport = () => {
  const currentUser  = useSelector((s) => s.auth?.currentUser);
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const properties   = useSelector(selectAllProperties);
  const canExport = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");

  const businessId = useMemo(() => {
    const activeId = localStorage.getItem("milik_active_company_id");
    const storedUser = (() => { try { return JSON.parse(localStorage.getItem("milik_user") || "null"); } catch { return null; } })();
    return (
      currentCompany?._id || currentUser?.company?._id || currentUser?.company ||
      currentUser?.businessId || activeId || storedUser?.company?._id || storedUser?.company || storedUser?.businessId || ""
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
  const [report, setReport] = useState(null);
  const [filters, setFilters] = useTabState("/accounts/cash-flow:filters", () => ({ startDate: firstDayOfMonth(), endDate: todayString() }));

  const loadReport = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getCashFlowReport({ business: businessId, startDate: filters.startDate, endDate: filters.endDate });
      setReport(data);
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || "Failed to load cash flow report");
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.startDate, filters.endDate]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const summary = report?.summary || {};
  const operating = report?.operating || { items: [], totalInflows: 0, totalOutflows: 0, net: 0 };
  const financing = report?.financing || { items: [], totalInflows: 0, totalOutflows: 0, net: 0 };
  const adjustments = report?.adjustments || { items: [], totalInflows: 0, totalOutflows: 0, net: 0 };
  const cashAccounts = report?.cashAccounts || [];
  const note = report?.note || null;

  const closingColor = summary.closingCash >= 0 ? "#166534" : RED;
  const netChangeColor = summary.netChange >= 0 ? "#166534" : RED;

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    if (!canExport) return toast.warning("You do not have permission to export reports");
    if (!report) return;

    const lines = [
      "CASH FLOW STATEMENT",
      `Period,${filters.startDate} to ${filters.endDate}`,
      `Business,${businessName}`,
      "",
    ];

    const addSection = (title, section) => {
      lines.push(title);
      lines.push("Item,Cash In,Cash Out,Net");
      (section.items || []).forEach((i) =>
        lines.push(`"${String(i.label).replaceAll('"', '""')}",${i.inflow.toFixed(2)},${i.outflow.toFixed(2)},${i.net.toFixed(2)}`)
      );
      lines.push(`,"Total In",${section.totalInflows.toFixed(2)}`);
      lines.push(`,"Total Out",,${section.totalOutflows.toFixed(2)}`);
      lines.push(`,"Net",,${section.net.toFixed(2)}`);
      lines.push("");
    };

    addSection("OPERATING ACTIVITIES", operating);
    addSection("FINANCING ACTIVITIES", financing);
    addSection("OTHER ADJUSTMENTS", adjustments);

    lines.push("SUMMARY");
    lines.push(`Opening Cash Balance,,${Number(summary.openingCash || 0).toFixed(2)}`);
    lines.push(`Net Cash from Operations,,${Number(summary.netCashFromOperations || 0).toFixed(2)}`);
    lines.push(`Net Cash from Financing,,${Number(summary.netCashFromFinancing || 0).toFixed(2)}`);
    lines.push(`Net Cash from Adjustments,,${Number(summary.netCashFromAdjustments || 0).toFixed(2)}`);
    lines.push(`Net Change in Cash,,${Number(summary.netChange || 0).toFixed(2)}`);
    lines.push(`Closing Cash Balance,,${Number(summary.closingCash || 0).toFixed(2)}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", `cash_flow_${filters.startDate}_to_${filters.endDate}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported successfully");
  };

  // ── Print PDF ───────────────────────────────────────────────────────────────
  const handlePrintPDF = () => {
    if (!canExport) return toast.warning("You do not have permission to print reports");
    if (!report) return toast.info("Report is still loading.");
    const block = (heading, section) => [
      { __group: heading, meta: `Net: KES ${fmtSigned(section.net)}` },
      ...(section.items || []),
      ...((section.items || []).length
        ? [{ __subtotal: ["Total", fmt(section.totalInflows), fmt(section.totalOutflows), fmtSigned(section.net)] }]
        : [{ __subtotal: ["No movements in this category.", "", "", ""] }]),
    ];
    const printed = printTabularList({
      title: "Cash Flow Statement",
      subtitle: `${filters.startDate} to ${filters.endDate}`,
      company: currentCompany,
      orientation: "portrait",
      summaryItems: [
        ["Opening cash", `KES ${fmt(summary.openingCash)}`],
        ["From operations", `KES ${fmtSigned(summary.netCashFromOperations)}`],
        ["From financing", `KES ${fmtSigned(summary.netCashFromFinancing)}`],
        ["Net change", `KES ${fmtSigned(summary.netChange)}`],
        ["Closing cash", `KES ${fmt(summary.closingCash)}`],
      ],
      columns: [
        { label: "Item", value: (item) => item.label },
        { label: "Cash in", align: "right", value: (item) => (item.inflow > 0 ? fmt(item.inflow) : "—") },
        { label: "Cash out", align: "right", tone: () => "neg", value: (item) => (item.outflow > 0 ? fmt(item.outflow) : "—") },
        { label: "Net", align: "right", bold: true, tone: (item) => (item.net >= 0 ? "pos" : "neg"), value: (item) => fmtSigned(item.net) },
      ],
      rows: [
        ...block("Operating activities", operating),
        ...block("Financing activities", financing),
        ...block("Other adjustments", adjustments),
        { __group: "Cash position summary" },
        { __subtotal: ["Opening cash balance", "", "", fmt(summary.openingCash)] },
        { __subtotal: ["+ Net cash from operations", "", "", fmtSigned(summary.netCashFromOperations)] },
        { __subtotal: ["+ Net cash from financing", "", "", fmtSigned(summary.netCashFromFinancing)] },
        { __subtotal: ["+ Net cash from adjustments", "", "", fmtSigned(summary.netCashFromAdjustments)] },
      ],
      totalsRow: ["Closing cash balance", "", "", fmt(summary.closingCash)],
      signatures: [{ label: "Prepared by" }, { label: "Reviewed by" }],
    });
    if (!printed) toast.error("Popup blocked. Allow popups to print.");
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="h-[calc(100dvh-152px)] max-h-[calc(100dvh-152px)] overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">

          {/* ── Sticky toolbar ──────────────────────────────────────────────── */}
          <div className="sticky top-0 z-30 shrink-0 border-b border-gray-200 bg-gray-50/95 p-2 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-800">Cash Flow Statement</span>

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
                disabled={!canExport || !report}
                title={!canExport ? "No export permission" : "Export CSV"}
                className="flex h-7 items-center gap-1.5 rounded bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00] disabled:opacity-50"
              >
                <FaFileDownload size={9} /> Export CSV
              </button>
              <button
                onClick={handlePrintPDF}
                disabled={!canExport || !report}
                title={!canExport ? "No print permission" : "Print PDF"}
                className="flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                <FaFilePdf size={9} /> Print PDF
              </button>
            </div>

            {/* Business badge */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {businessName}
              </span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                Direct method · cash &amp; bank account movements
              </span>
              {note && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {note}
                </span>
              )}
            </div>
          </div>

          {/* ── Property GL notice ──────────────────────────────────────────── */}
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

          {/* ── KPI strip ───────────────────────────────────────────────────── */}
          <div className="shrink-0 grid grid-cols-5 divide-x divide-slate-200 border-b border-slate-200 bg-white">
            {[
              { label: "Opening Cash",       value: summary.openingCash,           color: "#1e293b" },
              { label: "Cash from Ops",      value: summary.netCashFromOperations, color: summary.netCashFromOperations >= 0 ? "#166534" : RED },
              { label: "Cash from Financing",value: summary.netCashFromFinancing,  color: summary.netCashFromFinancing >= 0 ? "#166534" : RED },
              { label: "Net Change",         value: summary.netChange,             color: netChangeColor },
              { label: "Closing Cash",       value: summary.closingCash,           color: closingColor },
            ].map(({ label, value, color }) => (
              <div key={label} className="px-4 py-3">
                <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
                <div className="text-base font-black tabular-nums" style={{ color }}>
                  KES {fmtSigned(value)}
                </div>
              </div>
            ))}
          </div>

          {/* ── Scrollable content ───────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-xs font-semibold text-slate-400">
                Loading cash flow data…
              </div>
            ) : (
              <>
                {/* Three cash-flow sections */}
                <CashSection title="Operating Activities" accentColor={GRN} {...operating} />
                <CashSection title="Financing Activities" accentColor="#1d4ed8" {...financing} />
                <CashSection title="Other Adjustments" accentColor="#7c3aed" {...adjustments} />

                {/* Cash position summary bar */}
                <div
                  className="mt-4 rounded-xl border-2 px-5 py-4"
                  style={{ borderColor: closingColor, background: summary.closingCash >= 0 ? "#f0fdf4" : "#fef2f2" }}
                >
                  <div className="mb-3 text-[9px] font-black uppercase tracking-widest" style={{ color: closingColor }}>
                    Cash Position Summary
                  </div>
                  {[
                    { label: "Opening Cash Balance",         value: summary.openingCash,            indent: false },
                    { label: "+ Net Cash from Operations",   value: summary.netCashFromOperations,  indent: true  },
                    { label: "+ Net Cash from Financing",    value: summary.netCashFromFinancing,   indent: true  },
                    { label: "+ Net Cash from Adjustments", value: summary.netCashFromAdjustments, indent: true  },
                    { label: "= Net Change in Cash",         value: summary.netChange,              indent: false },
                  ].map(({ label, value, indent }) => (
                    <div key={label} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs">
                      <span className={`font-medium ${indent ? "pl-4 text-slate-500" : "text-slate-700"}`}>{label}</span>
                      <span className="font-mono font-semibold" style={{ color: value < 0 ? RED : "#1e293b" }}>
                        KES {fmtSigned(value)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-2 flex items-center justify-between text-base font-black" style={{ color: closingColor }}>
                    <span>Closing Cash Balance</span>
                    <span className="font-mono">KES {fmt(summary.closingCash)}</span>
                  </div>
                </div>

                {/* Cash accounts breakdown */}
                {cashAccounts.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      Cash &amp; Bank Accounts
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      {cashAccounts.map((acc, i) => (
                        <div
                          key={String(acc._id)}
                          className={`flex items-center justify-between px-4 py-2 text-xs ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"} ${i > 0 ? "border-t border-slate-100" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-12 shrink-0 font-mono text-[10px] font-semibold text-slate-400">{acc.code}</span>
                            <span className="font-medium text-slate-700">{acc.name}</span>
                            {acc.subGroup && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">{acc.subGroup}</span>
                            )}
                          </div>
                          <span className="font-mono font-semibold text-slate-700">KES {fmt(acc.openingBalance)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default CashFlowReport;
