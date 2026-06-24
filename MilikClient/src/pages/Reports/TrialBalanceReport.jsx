import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { hasCompanyPermission } from "../../utils/permissions";
import { selectCurrentCompany, selectCurrentUser } from "../../redux/selectors";
import { FaBalanceScale, FaFileDownload, FaFilePdf, FaFilter, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTrialBalanceReport } from "../../redux/apiCalls";

const MILIK_GREEN = "#0B3B2E";
const MILIK_ORANGE = "#FF8C00";
const MILIK_RED = "#DC2626";

const formatMoney = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const todayString = () => new Date().toISOString().split("T")[0];

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const TrialBalanceReport = () => {
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
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

  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState({
    rows: [],
    totals: { debit: 0, credit: 0, difference: 0, balanced: true },
    asOfDate: new Date().toISOString(),
    count: 0,
  });
  const [filters, setFilters] = useState({
    asOfDate: todayString(),
    includeZeroBalances: false,
  });

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

    const printWindow = window.open("", "_blank", "width=1200,height=900");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print the report.");
      return;
    }

    const rowsHtml = (report.rows || []).length
      ? report.rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.code || "")}</td>
                <td>${escapeHtml(row.name || "")}</td>
                <td>${escapeHtml(row.type || "")}</td>
                <td>${escapeHtml(row.group || "")}</td>
                <td>${escapeHtml(row.subGroup || "-")}</td>
                <td class="amount">${row.debitBalance ? `KES ${escapeHtml(formatMoney(row.debitBalance))}` : "-"}</td>
                <td class="amount">${row.creditBalance ? `KES ${escapeHtml(formatMoney(row.creditBalance))}` : "-"}</td>
              </tr>
            `
          )
          .join("")
      : `
          <tr>
            <td colspan="7" class="empty-row">No trial balance rows found for the selected date.</td>
          </tr>
        `;

    const printableHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Trial Balance - ${escapeHtml(filters.asOfDate)}</title>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: Arial, Helvetica, sans-serif;
              margin: 0;
              padding: 24px;
              color: #111827;
              background: #ffffff;
            }
            .report-wrap {
              width: 100%;
              max-width: 1100px;
              margin: 0 auto;
            }
            .report-header {
              margin-bottom: 20px;
              border-bottom: 2px solid ${MILIK_GREEN};
              padding-bottom: 12px;
            }
            .report-title {
              font-size: 30px;
              font-weight: 800;
              color: ${MILIK_GREEN};
              margin: 0 0 6px 0;
            }
            .report-subtitle {
              font-size: 14px;
              font-weight: 600;
              color: #4b5563;
              margin: 0;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 12px;
              margin: 18px 0 20px 0;
            }
            .meta-box {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 12px 14px;
              background: #f9fafb;
            }
            .meta-label {
              font-size: 12px;
              font-weight: 700;
              color: #4b5563;
              margin-bottom: 4px;
              text-transform: uppercase;
            }
            .meta-value {
              font-size: 16px;
              font-weight: 800;
              color: #111827;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 12px;
              margin-bottom: 20px;
            }
            .summary-card {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              padding: 12px 14px;
              background: #ffffff;
            }
            .summary-label {
              font-size: 12px;
              font-weight: 700;
              color: #4b5563;
              margin-bottom: 4px;
              text-transform: uppercase;
            }
            .summary-value {
              font-size: 18px;
              font-weight: 800;
              color: #111827;
            }
            .summary-status-ok { color: ${MILIK_GREEN}; }
            .summary-status-bad { color: ${MILIK_RED}; }

            .print-card {
              border: 1px solid #d1d5db;
              border-radius: 8px;
              overflow: hidden;
              background: #ffffff;
            }
            .card-header {
              background: ${MILIK_GREEN};
              color: #ffffff;
              padding: 12px 14px;
              font-size: 16px;
              font-weight: 800;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            thead th {
              background: #f9fafb;
              color: #1f2937;
              text-align: left;
              font-size: 12px;
              font-weight: 800;
              padding: 12px 14px;
              border-bottom: 1px solid #d1d5db;
            }
            tbody td {
              font-size: 13px;
              font-weight: 600;
              color: #374151;
              padding: 12px 14px;
              border-bottom: 1px solid #e5e7eb;
            }
            tbody td:first-child {
              font-weight: 800;
              color: #111827;
            }
            .amount {
              text-align: right;
              white-space: nowrap;
              font-weight: 800;
              color: #111827;
            }
            .empty-row {
              text-align: center;
              color: #6b7280;
              font-weight: 600;
              padding: 24px 14px;
            }
            tfoot td {
              background: #f3f4f6;
              font-size: 13px;
              font-weight: 800;
              color: #111827;
              padding: 12px 14px;
              border-top: 2px solid #d1d5db;
            }
            .tfoot-label {
              text-align: right;
            }

            @media print {
              body {
                padding: 0;
              }
              .report-wrap {
                max-width: none;
              }
              @page {
                size: A4 landscape;
                margin: 12mm;
              }
            }
          </style>
        </head>
        <body>
          <div class="report-wrap">
            <div class="report-header">
              <h1 class="report-title">Trial Balance</h1>
              <p class="report-subtitle">Built from chart accounts and ledger entries as one accounting source of truth.</p>
            </div>

            <div class="meta-grid">
              <div class="meta-box">
                <div class="meta-label">Business</div>
                <div class="meta-value">${escapeHtml(businessName)}</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">As At Date</div>
                <div class="meta-value">${escapeHtml(filters.asOfDate)}</div>
              </div>
              <div class="meta-box">
                <div class="meta-label">Rows</div>
                <div class="meta-value">${escapeHtml(report.count || 0)}</div>
              </div>
            </div>

            <div class="summary-grid">
              <div class="summary-card">
                <div class="summary-label">Total Debits</div>
                <div class="summary-value">KES ${escapeHtml(formatMoney(report.totals?.debit))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Total Credits</div>
                <div class="summary-value">KES ${escapeHtml(formatMoney(report.totals?.credit))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Difference</div>
                <div class="summary-value">KES ${escapeHtml(formatMoney(report.totals?.difference))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Status</div>
                <div class="summary-value ${report.totals?.balanced ? "summary-status-ok" : "summary-status-bad"}">
                  ${escapeHtml(report.totals?.balanced ? "Balanced" : "Out of Balance")}
                </div>
              </div>
            </div>

            <div class="print-card">
              <div class="card-header">Trial Balance Details</div>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Account Name</th>
                    <th>Type</th>
                    <th>Group</th>
                    <th>Sub Group</th>
                    <th style="text-align:right;">Debit</th>
                    <th style="text-align:right;">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="5" class="tfoot-label">TOTAL</td>
                    <td class="amount">KES ${escapeHtml(formatMoney(report.totals?.debit))}</td>
                    <td class="amount">KES ${escapeHtml(formatMoney(report.totals?.credit))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(printableHtml);
    printWindow.document.close();
    printWindow.focus();

    const triggerPrint = () => {
      printWindow.print();
    };

    if (printWindow.document.readyState === "complete") {
      setTimeout(triggerPrint, 300);
    } else {
      printWindow.onload = () => setTimeout(triggerPrint, 300);
    }
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
          <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur print:hidden">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto_auto]">
              <input
                type="date"
                value={filters.asOfDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, asOfDate: e.target.value }))}
                className="h-8 rounded-md border border-orange-300 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#0B3B2E] focus:bg-white focus:ring-1 focus:ring-[#0B3B2E]/20"
              />
              <label className="inline-flex h-8 items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-2.5 text-xs font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={filters.includeZeroBalances}
                  onChange={(e) => setFilters((prev) => ({ ...prev, includeZeroBalances: e.target.checked }))}
                />
                Include zero balances
              </label>
              <button onClick={loadReport} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[11px] font-bold text-white hover:bg-blue-700"><FaSyncAlt /> Refresh</button>
              <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? "Export CSV" : "You do not have permission to export reports"} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00] disabled:opacity-50"><FaFileDownload /> Export CSV</button>
              <button onClick={handlePrintPDF} disabled={!canExportReports} title={canExportReports ? "Print" : "You do not have permission to print reports"} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"><FaFilePdf /> Print PDF</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">Business: <span className="text-slate-900">{businessName}</span></span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600">Rows: <span className="text-slate-900">{report.count || 0}</span></span>
            </div>
          </div>

          <div className="grid flex-shrink-0 grid-cols-2 gap-1.5 md:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Total Debits</div>
              <div className="text-xs font-black tracking-tight text-gray-900">KES {formatMoney(report.totals?.debit)}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Total Credits</div>
              <div className="text-xs font-black tracking-tight text-gray-900">KES {formatMoney(report.totals?.credit)}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Difference</div>
              <div className="text-xs font-black tracking-tight" style={{ color: Math.abs(Number(report.totals?.difference || 0)) < 0.005 ? MILIK_GREEN : MILIK_RED }}>
                KES {formatMoney(report.totals?.difference)}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Status</div>
              <div className="text-xs font-black tracking-tight" style={{ color: report.totals?.balanced ? MILIK_GREEN : MILIK_RED }}>
                {report.totals?.balanced ? "Balanced" : "Out of Balance"}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex-shrink-0 bg-[#0B3B2E] px-3 py-2 text-white flex items-center justify-between">
              <h3 className="text-sm font-extrabold tracking-wide">Trial Balance Details</h3>
              <div className="text-sm font-semibold opacity-95">
                As at {new Date(report.asOfDate || filters.asOfDate).toLocaleDateString()}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-800">Code</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-800">Account Name</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-800">Type</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-800">Group</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-800">Sub Group</th>
                    <th className="px-6 py-3 text-right text-sm font-bold text-gray-800">Debit</th>
                    <th className="px-6 py-3 text-right text-sm font-bold text-gray-800">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-gray-600 font-medium">
                        Loading trial balance...
                      </td>
                    </tr>
                  ) : report.rows?.length ? (
                    report.rows.map((row) => (
                      <tr key={row._id || `${row.code}-${row.name}`} className="border-t border-gray-200 hover:bg-gray-50">
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
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-gray-600 font-medium">
                        No trial balance rows found for the selected date.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-gray-100">
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-sm font-extrabold text-gray-900 text-right">
                      TOTAL
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-extrabold text-gray-900">
                      {formatMoney(report.totals?.debit)}
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-extrabold text-gray-900">
                      {formatMoney(report.totals?.credit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};
   
export default TrialBalanceReport;