import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
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
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);

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

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 flex items-center gap-3">
                  <FaBalanceScale style={{ color: MILIK_GREEN }} />
                  Trial Balance
                </h1>
                <p className="text-gray-700 mt-1 font-medium">
                  Built from chart accounts and ledger entries as one accounting source of truth.
                </p>
              </div>
              <div className="flex gap-3 print:hidden flex-wrap">
                <button
                  onClick={loadReport}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition"
                >
                  <FaSyncAlt /> Refresh
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold transition"
                >
                  <FaFileDownload /> Export CSV
                </button>
                <button
                  onClick={handlePrintPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0B3B2E] hover:bg-[#0A3127] text-white rounded-lg font-bold transition"
                >
                  <FaFilePdf /> Print PDF
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-6 print:hidden">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <FaFilter style={{ color: MILIK_ORANGE }} />
              Filters
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">As At Date</label>
                <input
                  type="date"
                  value={filters.asOfDate}
                  onChange={(e) => setFilters((prev) => ({ ...prev, asOfDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent font-semibold text-gray-800"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">Options</label>
                <label className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg bg-white">
                  <input
                    type="checkbox"
                    checked={filters.includeZeroBalances}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, includeZeroBalances: e.target.checked }))
                    }
                  />
                  <span className="text-sm font-semibold text-gray-800">Include zero balance accounts</span>
                </label>
              </div>
              <div className="text-sm text-gray-700 font-medium">
                <div>
                  <span className="font-bold">Business:</span> {businessName}
                </div>
                <div>
                  <span className="font-bold">Rows:</span> {report.count || 0}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Debits</div>
              <div className="text-4xl font-extrabold tracking-tight text-gray-900">
                KES {formatMoney(report.totals?.debit)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Total Credits</div>
              <div className="text-4xl font-extrabold tracking-tight text-gray-900">
                KES {formatMoney(report.totals?.credit)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Difference</div>
              <div
                className="text-4xl font-extrabold tracking-tight"
                style={{
                  color:
                    Math.abs(Number(report.totals?.difference || 0)) < 0.005
                      ? MILIK_GREEN
                      : MILIK_RED,
                }}
              >
                KES {formatMoney(report.totals?.difference)}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-bold text-gray-700 mb-1">Status</div>
              <div
                className="text-3xl font-extrabold tracking-tight"
                style={{ color: report.totals?.balanced ? MILIK_GREEN : MILIK_RED }}
              >
                {report.totals?.balanced ? "Balanced" : "Out of Balance"}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="bg-[#0B3B2E] text-white px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-extrabold tracking-wide">Trial Balance Details</h3>
              <div className="text-sm font-semibold opacity-95">
                As at {new Date(report.asOfDate || filters.asOfDate).toLocaleDateString()}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
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