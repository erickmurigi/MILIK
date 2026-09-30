import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from "../../redux/selectors";
import { FaExclamationCircle, FaExclamationTriangle, FaFileDownload, FaFilePdf, FaInfoCircle, FaSyncAlt, FaTimes } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikTable from "../../components/common/MilikTable";
import { getTrialBalanceExceptions, getTrialBalanceReport } from "../../redux/apiCalls";
import { printTabularList } from "../../utils/printList";
import { formatMoney } from "../../utils/money";

const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";
const MILIK_RED = "#DC2626";

const todayString = () => new Date().toISOString().split("T")[0];

const TrialBalanceReport = () => {
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const properties = useSelector(selectAllProperties);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");

  const businessId = useMemo(() => {
    const activeCompanyId = localStorage.getItem("milik_active_company_id");
    const storedUser = (() => {
      try {
        return JSON.parse(localStorage.getItem("milik_user") || "null");
      } catch {
        return null;
      }
    })();

    return (
      currentCompany?._id ||
      currentUser?.company?._id ||
      currentUser?.company ||
      currentUser?.businessId ||
      activeCompanyId ||
      storedUser?.company?._id ||
      storedUser?.company ||
      storedUser?.businessId ||
      ""
    );
  }, [currentCompany?._id, currentUser?.company, currentUser?.businessId]);

  const businessName =
    currentCompany?.companyName || currentUser?.company?.companyName || "Active company";

  const offGLProperties = useMemo(
    () => properties.filter((p) => {
      const v = String(p.accountLedgerType || "").toLowerCase().trim();
      return (v.startsWith("off") || v === "property-gl") && String(p.status || "").toLowerCase() !== "archived";
    }),
    [properties]
  );

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState({
    rows: [],
    totals: { debit: 0, credit: 0, difference: 0, balanced: true },
    asOfDate: new Date().toISOString(),
    count: 0,
  });
  const [filters, setFilters] = useTabState("/accounts/trial-balance:filters", { asOfDate: todayString(), includeZeroBalances: false });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const loadReport = useCallback(async () => {
    if (!businessId) {
      setReport((prev) => ({
        ...prev,
        rows: [],
        count: 0,
        totals: { debit: 0, credit: 0, difference: 0, balanced: true },
      }));
      return;
    }

    setLoading(true);
    try {
      const data = await getTrialBalanceReport({
        business: businessId,
        asOfDate: filters.asOfDate,
        includeZeroBalances: filters.includeZeroBalances,
      });
      setReport(
        data || {
          rows: [],
          totals: { debit: 0, credit: 0, difference: 0, balanced: true },
        }
      );
    } catch (error) {
      console.error("Failed to load trial balance", error);
      toast.error(
        error?.response?.data?.error || error?.message || "Failed to load trial balance"
      );
    } finally {
      setLoading(false);
    }
  }, [businessId, filters.asOfDate, filters.includeZeroBalances]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const [exceptions, setExceptions] = useState(null);
  const [exceptionsLoading, setExceptionsLoading] = useState(false);
  const [showExceptions, setShowExceptions] = useState(false);

  const checkExceptions = useCallback(async () => {
    if (!businessId) return;
    setExceptionsLoading(true);
    setShowExceptions(true);
    try {
      const data = await getTrialBalanceExceptions({ business: businessId });
      setExceptions(data);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to check exceptions");
      setShowExceptions(false);
    } finally {
      setExceptionsLoading(false);
    }
  }, [businessId]);

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.warning("You do not have permission to export reports");
      return;
    }
    const csvData = [
      ["Code", "Account Name", "Type", "Group", "Sub Group", "Debit", "Credit"].join(","),
      ...report.rows.map((row) =>
        [
          row.code,
          `"${String(row.name || "").replaceAll('"', '""')}"`,
          row.type,
          `"${String(row.group || "").replaceAll('"', '""')}"`,
          `"${String(row.subGroup || "").replaceAll('"', '""')}"`,
          Number(row.debitBalance || 0).toFixed(2),
          Number(row.creditBalance || 0).toFixed(2),
        ].join(",")
      ),
      [
        "",
        "",
        "",
        "",
        "TOTAL",
        Number(report.totals?.debit || 0).toFixed(2),
        Number(report.totals?.credit || 0).toFixed(2),
      ].join(","),
    ].join("\n");

    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `trial_balance_${filters.asOfDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Trial balance exported successfully");
  };

  const handlePrintPDF = () => {
    if (!canExportReports) {
      toast.warning("You do not have permission to print reports");
      return;
    }
    if (loading) {
      toast.info("Please wait for the report to finish loading.");
      return;
    }

    const totals = report.totals || {};
    const printed = printTabularList({
      title: "Trial Balance",
      subtitle: `As at ${filters.asOfDate}`,
      company: currentCompany,
      summaryItems: [
        ["Total debits", `KES ${formatMoney(totals.debit)}`],
        ["Total credits", `KES ${formatMoney(totals.credit)}`],
        ["Difference", `KES ${formatMoney(totals.difference)}`],
        ["Status", totals.balanced ? "Balanced" : "Out of balance"],
        ["Accounts", String(report.count || 0)],
      ],
      columns: [
        { label: "Code", bold: true, value: (row) => row.code || "" },
        { label: "Account name", value: (row) => row.name || "" },
        { label: "Type", value: (row) => row.type || "" },
        { label: "Group", value: (row) => row.group || "" },
        { label: "Sub group", value: (row) => row.subGroup || "-" },
        { label: "Debit", align: "right", value: (row) => (row.debitBalance ? formatMoney(row.debitBalance) : "-") },
        { label: "Credit", align: "right", value: (row) => (row.creditBalance ? formatMoney(row.creditBalance) : "-") },
      ],
      rows: report.rows || [],
      totalsRow: ["TOTAL", "", "", "", "", formatMoney(totals.debit), formatMoney(totals.credit)],
      signatures: [{ label: "Prepared by", name: currentUser?.name || currentUser?.username || currentUser?.email || "" }, { label: "Reviewed by" }],
    });
    if (!printed) toast.error("Popup blocked. Please allow popups to print the report.");
  };

  const preparedBy = currentUser?.name || currentUser?.username || currentUser?.email || "System";

  return (
    <DashboardLayout lockContentScroll>
      {/* ── Native print (Ctrl+P) fallback ─────────────────────────── */}
      <div className="print-only-wrapper">
        <style>{`
          .tb-print-header { border-bottom: 3px solid #0B3B2E; padding-bottom: 10px; margin-bottom: 16px; }
          .tb-print-company { font-size: 18px; font-weight: 900; color: #0B3B2E; margin: 0 0 2px; }
          .tb-print-title { font-size: 14px; font-weight: 700; color: #374151; margin: 0 0 2px; }
          .tb-print-meta { font-size: 11px; color: #6b7280; margin: 0; }
          .tb-print-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
          .tb-print-metric { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; background: #f9fafb; }
          .tb-print-metric-label { font-size: 9px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 2px; }
          .tb-print-metric-value { font-size: 13px; font-weight: 900; color: #111827; }
          .tb-print-metric-value.bad { color: #DC2626; }
          .tb-print-metric-value.ok { color: #0B3B2E; }
          .tb-print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
          .tb-print-table thead th { background: #0B3B2E; color: #fff; padding: 6px 8px; text-align: left; font-size: 9px; font-weight: 800; text-transform: uppercase; }
          .tb-print-table thead th.r { text-align: right; }
          .tb-print-table tbody tr { border-bottom: 1px solid #e5e7eb; }
          .tb-print-table tbody tr:nth-child(even) { background: #f9fafb; }
          .tb-print-table tbody td { padding: 5px 8px; color: #374151; font-weight: 600; }
          .tb-print-table tbody td.code { font-weight: 900; color: #111827; }
          .tb-print-table tbody td.r { text-align: right; font-weight: 800; white-space: nowrap; }
          .tb-print-table tfoot td { background: #f3f4f6; padding: 6px 8px; font-weight: 900; border-top: 2px solid #d1d5db; }
          .tb-print-table tfoot td.r { text-align: right; }
          .tb-print-footer { margin-top: 14px; font-size: 9px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px; display: flex; justify-content: space-between; }
        `}</style>

        <div className="tb-print-header">
          <p className="tb-print-company">{businessName}</p>
          <p className="tb-print-title">Trial Balance</p>
          <p className="tb-print-meta">As at {filters.asOfDate} &nbsp;|&nbsp; Generated: {new Date().toLocaleDateString()}</p>
        </div>

        <div className="tb-print-metrics">
          <div className="tb-print-metric">
            <div className="tb-print-metric-label">Total Debits</div>
            <div className="tb-print-metric-value">KES {formatMoney(report.totals?.debit)}</div>
          </div>
          <div className="tb-print-metric">
            <div className="tb-print-metric-label">Total Credits</div>
            <div className="tb-print-metric-value">KES {formatMoney(report.totals?.credit)}</div>
          </div>
          <div className="tb-print-metric">
            <div className="tb-print-metric-label">Difference</div>
            <div className={`tb-print-metric-value ${Math.abs(Number(report.totals?.difference || 0)) < 0.005 ? "ok" : "bad"}`}>
              KES {formatMoney(report.totals?.difference)}
            </div>
          </div>
          <div className="tb-print-metric">
            <div className="tb-print-metric-label">Status</div>
            <div className={`tb-print-metric-value ${report.totals?.balanced ? "ok" : "bad"}`}>
              {report.totals?.balanced ? "Balanced" : "Out of Balance"}
            </div>
          </div>
        </div>

        <table className="tb-print-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Account Name</th>
              <th>Type</th>
              <th>Group</th>
              <th>Sub Group</th>
              <th className="r">Debit</th>
              <th className="r">Credit</th>
            </tr>
          </thead>
          <tbody>
            {report.rows?.length ? report.rows.map((row) => (
              <tr key={row._id || `${row.code}-${row.name}`}>
                <td className="code">{row.code}</td>
                <td>{row.name}</td>
                <td style={{ textTransform: "capitalize" }}>{row.type}</td>
                <td>{row.group}</td>
                <td>{row.subGroup || "-"}</td>
                <td className="r">{row.debitBalance ? formatMoney(row.debitBalance) : "-"}</td>
                <td className="r">{row.creditBalance ? formatMoney(row.creditBalance) : "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan="7" style={{ textAlign: "center", padding: "16px", color: "#6b7280" }}>No data found.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="5" className="r">TOTAL</td>
              <td className="r">{formatMoney(report.totals?.debit)}</td>
              <td className="r">{formatMoney(report.totals?.credit)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="tb-print-footer">
          <span>Rows: {report.count || 0}</span>
          <span>Prepared by: {preparedBy}</span>
        </div>
      </div>

      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-100 p-2">
        <div className="flex w-full max-w-full min-h-0 flex-1 flex-col overflow-hidden gap-2">
          <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 px-2 pt-2 pb-1.5 shadow-sm backdrop-blur print:hidden">
            {/* Controls row — filters left, actions right */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Filters */}
              <input
                type="date"
                value={filters.asOfDate}
                onChange={setFilter("asOfDate")}
                className="h-8 border border-orange-300 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0B3B2E] focus:bg-white"
              />
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 border border-orange-300 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={filters.includeZeroBalances}
                  onChange={(e) => setFilters((prev) => ({ ...prev, includeZeroBalances: e.target.checked }))}
                />
                Zero balances
              </label>

              {/* Meta chips */}
              <span className="hidden border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600 sm:inline-flex">
                {businessName}
              </span>
              <span className="border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">
                {report.count || 0} rows
              </span>

              {/* Balance status pill */}
              <span className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-bold uppercase tracking-wide ${report.totals?.balanced ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {report.totals?.balanced ? "✓ Balanced" : "✗ Out of Balance"}
              </span>

              {/* Action buttons — pushed to far right */}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={loadReport}
                  disabled={loading}
                  className="inline-flex h-8 items-center gap-1.5 bg-blue-600 px-3 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <FaSyncAlt className={loading ? "animate-spin" : ""} /> Refresh
                </button>
                <button
                  onClick={checkExceptions}
                  disabled={exceptionsLoading}
                  className="inline-flex h-8 items-center gap-1.5 bg-amber-500 px-3 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-60"
                  title="Scan for accounts with abnormal balances or other issues"
                >
                  <FaExclamationTriangle /> {exceptionsLoading ? "Scanning…" : "Exceptions"}
                </button>
                <button
                  onClick={handleExportCSV}
                  disabled={!canExportReports}
                  title={canExportReports ? "Export to CSV" : "No permission"}
                  className="inline-flex h-8 items-center gap-1.5 border border-[#FF8C00] bg-white px-3 text-[11px] font-bold text-[#FF8C00] hover:bg-orange-50 disabled:opacity-50"
                >
                  <FaFileDownload /> CSV
                </button>
                <button
                  onClick={handlePrintPDF}
                  disabled={!canExportReports}
                  title={canExportReports ? "Print PDF" : "No permission"}
                  className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
                >
                  <FaFilePdf /> Print
                </button>
              </div>
            </div>
          </div>

          {/* ── Property GL notice ───────────────────────────────────── */}
          {offGLProperties.length > 0 && (
            <div className="flex-shrink-0 flex items-center gap-2 border border-purple-200 bg-purple-50 px-3 py-1.5 print:hidden">
              <span className="text-purple-500 text-xs">⚠</span>
              <span className="text-[11px] text-purple-700">
                <span className="font-bold">{offGLProperties.length} {offGLProperties.length === 1 ? "property uses" : "properties use"} Property GL</span>
                {" "}and {offGLProperties.length === 1 ? "is" : "are"} excluded from this company report:{" "}
                {offGLProperties.map((p) => `${p.propertyCode} – ${p.propertyName}`).join(", ")}
                {". "}View their accounts via Property Ledger on the properties list.
              </span>
            </div>
          )}

          {/* ── Exceptions Panel ─────────────────────────────────────── */}
          {showExceptions && (
            <div className="flex-shrink-0 border border-amber-200 bg-amber-50 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between bg-amber-500 px-3 py-2">
                <div className="flex items-center gap-2 text-white">
                  <FaExclamationTriangle className="text-sm" />
                  <span className="text-[11px] font-extrabold tracking-wide uppercase">
                    Exceptions Report
                    {exceptions && !exceptionsLoading && (
                      <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                        {exceptions.count ?? 0} flag{(exceptions.count ?? 0) !== 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                </div>
                <button onClick={() => { setShowExceptions(false); setExceptions(null); }} className="text-white/80 hover:text-white">
                  <FaTimes className="text-sm" />
                </button>
              </div>

              {exceptionsLoading && (
                <div className="px-4 py-6 text-center text-xs text-amber-700">Scanning accounts…</div>
              )}

              {!exceptionsLoading && exceptions && exceptions.count === 0 && (
                <div className="flex items-center gap-2 px-4 py-4 text-sm font-semibold text-emerald-700">
                  <span className="text-lg">✓</span> No exceptions found — all account balances look normal.
                </div>
              )}

              {!exceptionsLoading && exceptions && exceptions.count > 0 && (
                <div className="divide-y divide-amber-200 max-h-64 overflow-y-auto">
                  {exceptions.exceptions.map((ex, i) => {
                    const Icon = ex.severity === "critical" ? FaExclamationCircle : ex.severity === "warning" ? FaExclamationTriangle : FaInfoCircle;
                    const colMap = { critical: "text-red-600", warning: "text-amber-600", info: "text-blue-600" };
                    return (
                      <div key={ex.account?._id || ex.account?.code || i} className="flex items-start gap-3 px-4 py-3">
                        <Icon className={`mt-0.5 shrink-0 ${colMap[ex.severity] || "text-gray-500"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-bold text-gray-800">
                              {ex.account?.code} — {ex.account?.name}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${ex.severity === "critical" ? "bg-red-100 text-red-700" : ex.severity === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                              {ex.severity}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold capitalize text-gray-600">
                              {ex.account?.type}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-gray-600">{ex.message}</p>
                          {ex.netBalance !== undefined && (
                            <p className="mt-0.5 text-[10px] font-bold text-gray-500">
                              Net balance: KES {formatMoney(ex.netBalance)} · {ex.entryCount} entr{ex.entryCount === 1 ? "y" : "ies"}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
            <div className="flex-shrink-0 bg-[#0B3B2E] px-3 py-2 text-white flex items-center justify-between">
              <h3 className="text-sm font-extrabold tracking-wide">Trial Balance Details</h3>
              <div className="text-sm font-semibold opacity-95">
                As at {new Date(report.asOfDate || filters.asOfDate).toLocaleDateString()}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
              <MilikTable
                columns={[
                  { label: "Code" },
                  { label: "Account Name" },
                  { label: "Type" },
                  { label: "Group" },
                  { label: "Sub Group" },
                  { label: "Debit", align: "right" },
                  { label: "Credit", align: "right" },
                ]}
                rows={report.rows || []}
                rowKey={(row) => row._id || `${row.code}-${row.name}`}
                loading={loading}
                empty="No trial balance rows found for the selected date."
                renderFooter={report.rows?.length > 0 ? () => (
                  <>
                    <td colSpan={5} className="px-6 py-4 text-sm font-extrabold text-gray-900 text-right">TOTAL</td>
                    <td className="px-6 py-4 text-sm text-right font-extrabold text-gray-900">{formatMoney(report.totals?.debit)}</td>
                    <td className="px-6 py-4 text-sm text-right font-extrabold text-gray-900">{formatMoney(report.totals?.credit)}</td>
                  </>
                ) : undefined}
                renderRow={(row) => (
                  <>
                    <td className="px-6 py-4 text-sm font-bold text-gray-900">{row.code}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-800">{row.name}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-700 capitalize">{row.type}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-700">{row.group}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-700">{row.subGroup || "-"}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-gray-900">
                      {row.debitBalance ? formatMoney(row.debitBalance) : "-"}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-gray-900">
                      {row.creditBalance ? formatMoney(row.creditBalance) : "-"}
                    </td>
                  </>
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};
   
export default TrialBalanceReport;